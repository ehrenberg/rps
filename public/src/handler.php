<?php
// API-Aktionen: verbindet Eingabe → Validierung → Spiellogik → DB. Kein HTTP (siehe api.php).
declare(strict_types=1);

require_once __DIR__ . '/game.php';
require_once __DIR__ . '/db.php';

const RPS_CODE_ATTEMPTS = 20;
const RPS_CLEANUP_PERCENT = 5;    // Wahrscheinlichkeit für Aufräumen bei Nicht-create-Requests
const RPS_VACUUM_PERCENT = 1;     // Wahrscheinlichkeit für VACUUM bei create

/**
 * Führt eine Aktion aus. Wirft RpsError bei fachlichen Fehlern.
 * @param callable(int):bool|null $chance Zufall „in x % der Fälle“ (für Tests ersetzbar)
 */
function rps_handle(PDO $pdo, array $in, int $now, ?callable $chance = null): array
{
    $chance ??= static fn(int $percent): bool => random_int(1, 100) <= $percent;
    $action = $in['action'] ?? null;
    if ($action === 'create') {
        return rps_action_create($pdo, $in, $now, $chance);
    }
    if ($chance(RPS_CLEANUP_PERCENT)) {
        rps_db_cleanup($pdo, $now);
    }
    return match ($action) {
        'info' => rps_action_info($pdo, $in),
        'join' => rps_action_join($pdo, $in, $now),
        'state' => rps_action_state($pdo, $in, $now),
        'commit' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_room_commit($r, $id, rps_valid_hash($in['hash'] ?? null), $now)),
        'reveal' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_room_reveal($r, $id, rps_valid_move_input($in['move'] ?? null), rps_valid_nonce($in['nonce'] ?? null))),
        'rematch' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_duel_rematch($r, $id)),
        'start' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_tournament_start($r, $id)),
        'react' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_room_react($r, $id, rps_valid_emoji($in['emoji'] ?? null), $now)),
        'claim' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_room_claim($r, $id, $now)),
        'leave' => rps_action_simple($pdo, $in, $now, static fn(array $r, string $id): array =>
            rps_room_leave($r, $id)),
        default => throw new RpsError('Unbekannte Aktion.', 400),
    };
}

function rps_valid_move_input(mixed $move): string
{
    if (!is_string($move) || $move === '') {
        throw new RpsError('Zug fehlt.', 400);
    }
    return $move;
}

function rps_action_create(PDO $pdo, array $in, int $now, callable $chance): array
{
    $type = rps_valid_type($in['type'] ?? null);
    $name = rps_clean_name($in['name'] ?? null);
    $variant = rps_valid_variant_input($in['variant'] ?? null);
    $bestOf = rps_valid_best_of($in['bestOf'] ?? null);

    rps_db_cleanup($pdo, $now);
    if (rps_db_count_rooms($pdo) >= RPS_MAX_ROOMS) {
        throw new RpsError('Gerade sind sehr viele Räume offen. Bitte versuche es später noch einmal.', 503);
    }
    [$token, $tokenHash] = rps_new_token();
    [$room, $me] = rps_room_add_player(rps_room_new($type, $variant, $bestOf), $name, $tokenHash, $now, false);
    $code = rps_insert_with_new_code($pdo, $room, $now);
    if ($chance(RPS_VACUUM_PERCENT)) {
        rps_db_vacuum($pdo);
    }
    return ['code' => $code, 'token' => $token, 'me' => $me];
}

function rps_insert_with_new_code(PDO $pdo, array $room, int $now): string
{
    for ($i = 0; $i < RPS_CODE_ATTEMPTS; $i++) {
        $code = rps_new_code();
        if (rps_db_insert_room($pdo, $code, $room, $now)) {
            return $code;
        }
    }
    throw new RpsError('Es konnte kein Raum erstellt werden. Bitte versuche es noch einmal.', 503);
}

/** Nur lesend: öffentliche Rauminfo für die Einladungsseite. */
function rps_action_info(PDO $pdo, array $in): array
{
    $code = rps_valid_code($in['code'] ?? null);
    $loaded = rps_db_load_room($pdo, $code) ?? throw rps_room_not_found();
    return rps_room_info($loaded['room'], $code);
}

function rps_action_join(PDO $pdo, array $in, int $now): array
{
    $code = rps_valid_code($in['code'] ?? null);
    $name = rps_clean_name($in['name'] ?? null);
    [$token, $tokenHash] = rps_new_token();
    return rps_with_room($pdo, $code, $now, static function (array $room) use ($name, $tokenHash, $now, $token): array {
        [$room, $id, $spectator] = rps_room_join(rps_room_tick($room, $now), $name, $tokenHash, $now);
        return [$room, ['token' => $token, 'me' => $id, 'spectator' => $spectator]];
    });
}

/** Authentifizierte, schreibende Aktion; Antwort {ok, version}. */
function rps_action_simple(PDO $pdo, array $in, int $now, callable $apply): array
{
    $code = rps_valid_code($in['code'] ?? null);
    $token = rps_valid_token($in['token'] ?? null);
    return rps_with_room($pdo, $code, $now, static function (array $room) use ($token, $now, $apply): array {
        $id = rps_room_require_player($room, $token);
        $room = rps_room_tick(rps_room_touch($room, $id, $now), $now);
        return [$apply($room, $id), static fn(int $v): array => ['ok' => true, 'version' => $v]];
    });
}

/**
 * `state`: liest ohne Sperre; schreibt nur, wenn Fristen fällig sind oder `seen` veraltet ist.
 */
function rps_action_state(PDO $pdo, array $in, int $now): array
{
    $code = rps_valid_code($in['code'] ?? null);
    $token = rps_valid_token($in['token'] ?? null);
    $since = isset($in['since']) && is_int($in['since']) ? $in['since'] : null;

    $loaded = rps_db_load_room($pdo, $code) ?? throw rps_room_not_found();
    $id = rps_room_require_player($loaded['room'], $token);
    [$room, $version] = [$loaded['room'], $loaded['version']];
    if (rps_state_update($room, $id, $now) !== $room) {
        [$room, $version] = rps_with_room($pdo, $code, $now, static function (array $r) use ($id, $now): array {
            $r = rps_state_update($r, $id, $now);
            return [$r, static fn(int $nv): array => [$r, $nv]];
        });
    }
    return $since === $version
        ? rps_room_unchanged_view($room, $version, $now)
        : rps_room_view($room, $code, $version, $id, $now);
}

/** Was `state` am Raum ändert: Fristen und ggf. seen. */
function rps_state_update(array $room, string $id, int $now): array
{
    if (isset($room['players'][$id]) && rps_room_seen_stale($room, $id, $now)) {
        $room = rps_room_touch($room, $id, $now);
    }
    return rps_room_tick($room, $now);
}

function rps_room_not_found(): RpsError
{
    return new RpsError('Diesen Raum gibt es nicht (mehr). Räume werden nach 24 Stunden gelöscht.', 404);
}

/**
 * Lädt den Raum in einer BEGIN-IMMEDIATE-Transaktion, wendet $fn an und speichert bei Änderung.
 * version +1 nur bei inhaltlicher Änderung (reines seen-Update zählt nicht).
 * $fn(room) → [room, result]; result darf ein callable(int $newVersion) sein.
 */
function rps_with_room(PDO $pdo, string $code, int $now, callable $fn): mixed
{
    return rps_db_transaction($pdo, static function () use ($pdo, $code, $now, $fn): mixed {
        $loaded = rps_db_load_room($pdo, $code) ?? throw rps_room_not_found();
        [$room, $result] = $fn($loaded['room']);
        $version = $loaded['version'];
        if (rps_room_essence($room) !== rps_room_essence($loaded['room'])) {
            $version++;
        }
        if ($room !== $loaded['room']) {
            rps_db_save_room($pdo, $code, $room, $version, $now);
        }
        return is_callable($result) ? $result($version) : $result;
    });
}
