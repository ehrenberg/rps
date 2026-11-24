<?php
// Raum-Grundlagen: Anlegen, Spieler, Authentifizierung, Online-Status, Reaktionen, Match-Verwaltung.
// Reine Funktionen auf Arrays („now“ als Parameter) – ohne HTTP und DB testbar.
declare(strict_types=1);

require_once __DIR__ . '/match.php';

const RPS_ONLINE_SECONDS = 15;      // seen jünger → online
const RPS_SEEN_WRITE_SECONDS = 5;   // seen nur schreiben, wenn älter
const RPS_CLAIM_SECONDS = 45;       // Gegner so lange weg → Sieg beanspruchbar
const RPS_REACT_INTERVAL = 1;       // Sekunden zwischen zwei Reaktionen eines Spielers
const RPS_REACTIONS_KEEP = 30;
const RPS_ROOM_MAX_PLAYERS = 32;    // Teilnehmer + Zuschauer (Turnier)
const RPS_PLAYER_ID_CHARS = 5;

function rps_room_new(string $type, string $variant, int $bestOf): array
{
    return [
        'type' => $type,
        'variant' => $variant,
        'bestOf' => $bestOf,
        'host' => null,
        'players' => [],
        'order' => [],
        'matches' => [],
        'current' => null,
        'series' => [],
        'rematch' => [],
        'bracket' => [],
        'status' => 'lobby',
        'champion' => null,
        'reactions' => [],
        'nextMatch' => 1,
        'nextReaction' => 1,
    ];
}

function rps_player_new(string $name, string $tokenHash, int $now, bool $spectator): array
{
    return [
        'name' => $name,
        'tokenHash' => $tokenHash,
        'joined' => $now,
        'seen' => $now,
        'spectator' => $spectator,
        'left' => false,
        'lastReact' => null,
    ];
}

function rps_room_new_player_id(array $room): string
{
    do {
        $id = 'p_' . rps_random_chars(RPS_PLAYER_ID_CHARS);
    } while (isset($room['players'][$id]));
    return $id;
}

/** @return array{0:array,1:string} [room, id] */
function rps_room_add_player(array $room, string $name, string $tokenHash, int $now, bool $spectator): array
{
    $taken = array_column($room['players'], 'name');
    $id = rps_room_new_player_id($room);
    $room['players'][$id] = rps_player_new(rps_unique_name($name, $taken), $tokenHash, $now, $spectator);
    $room['order'][] = $id;
    if ($room['host'] === null) {
        $room['host'] = $id;
    }
    return [$room, $id];
}

function rps_room_remove_player(array $room, string $id): array
{
    unset($room['players'][$id]);
    $room['order'] = array_values(array_filter($room['order'], static fn(string $p): bool => $p !== $id));
    return $room;
}

/** Spieler-ID zum Token oder null. */
function rps_room_find_player(array $room, string $token): ?string
{
    $hash = hash('sha256', $token);
    foreach ($room['players'] as $id => $p) {
        if (hash_equals($p['tokenHash'], $hash)) {
            return (string) $id;
        }
    }
    return null;
}

function rps_room_require_player(array $room, string $token): string
{
    $id = rps_room_find_player($room, $token);
    if ($id === null) {
        throw new RpsError('Du bist nicht in diesem Raum. Tritt über den Link neu bei.', 403);
    }
    return $id;
}

function rps_room_require_active(array $room, string $id): void
{
    if ($room['players'][$id]['left']) {
        throw new RpsError('Du hast den Raum verlassen.', 409);
    }
}

/** IDs der Spieler, die nicht gegangen sind (in Beitrittsreihenfolge). */
function rps_room_active_ids(array $room): array
{
    return array_values(array_filter($room['order'], static fn(string $id): bool => !$room['players'][$id]['left']));
}

function rps_room_touch(array $room, string $id, int $now): array
{
    $room['players'][$id]['seen'] = $now;
    return $room;
}

function rps_room_seen_stale(array $room, string $id, int $now): bool
{
    return $now - $room['players'][$id]['seen'] > RPS_SEEN_WRITE_SECONDS;
}

function rps_player_online(array $player, int $now): bool
{
    return !$player['left'] && $now - $player['seen'] < RPS_ONLINE_SECONDS;
}

/** @return array<string,bool> */
function rps_room_online(array $room, int $now): array
{
    $online = [];
    foreach ($room['order'] as $id) {
        $online[$id] = rps_player_online($room['players'][$id], $now);
    }
    return $online;
}

/** Raum ohne flüchtige Felder (seen) – Grundlage für die Entscheidung „version +1“. */
function rps_room_essence(array $room): array
{
    foreach ($room['players'] as $id => $p) {
        unset($room['players'][$id]['seen']);
    }
    return $room;
}

function rps_room_next_match_id(array $room): array
{
    $id = 'm' . $room['nextMatch'];
    $room['nextMatch']++;
    return [$room, $id];
}

/** ID des spielbaren Matches, in dem der Spieler steckt, oder null. */
function rps_room_my_match(array $room, string $id): ?string
{
    foreach ($room['matches'] as $mid => $m) {
        if (rps_match_playable($m) && rps_match_index($m, $id) !== null) {
            return (string) $mid;
        }
    }
    return null;
}

function rps_room_require_my_match(array $room, string $id): string
{
    $mid = rps_room_my_match($room, $id);
    if ($mid === null) {
        throw new RpsError('Du spielst gerade kein Match.', 409);
    }
    return $mid;
}

/**
 * Ersetzt ein Match und löst bei Matchende die Folgen aus (Serie im Duell, Baum im Turnier).
 */
function rps_room_put_match(array $room, string $mid, array $match): array
{
    $wasOver = rps_match_over($room['matches'][$mid]);
    $room['matches'][$mid] = $match;
    if (!$wasOver && rps_match_over($match)) {
        $room = $room['type'] === 'duel'
            ? rps_duel_on_match_end($room, $mid)
            : rps_tournament_settle($room);
    }
    return $room;
}

/** Lazy-Auswertung aller Fristen. */
function rps_room_tick(array $room, int $now): array
{
    foreach (array_keys($room['matches']) as $mid) {
        $m = $room['matches'][$mid];   // aktueller Stand (Matchende kann Folge-Matches ändern)
        $ticked = rps_match_tick($m, $now);
        if ($ticked !== $m) {
            $room = rps_room_put_match($room, (string) $mid, $ticked);
        }
    }
    return $room;
}

function rps_room_commit(array $room, string $id, string $hash, int $now): array
{
    rps_room_require_active($room, $id);
    $mid = rps_room_require_my_match($room, $id);
    $m = $room['matches'][$mid];
    return rps_room_put_match($room, $mid, rps_match_commit($m, rps_match_index($m, $id), $hash, $now));
}

function rps_room_reveal(array $room, string $id, string $move, string $nonce): array
{
    rps_room_require_active($room, $id);
    $mid = rps_room_require_my_match($room, $id);
    $m = $room['matches'][$mid];
    $idx = rps_match_index($m, $id);
    return rps_room_put_match($room, $mid, rps_match_reveal($m, $idx, $move, $nonce, $room['variant']));
}

/** Sieg beanspruchen, wenn der Gegner zu lange nicht gesehen wurde. */
function rps_room_claim(array $room, string $id, int $now): array
{
    rps_room_require_active($room, $id);
    $mid = rps_room_require_my_match($room, $id);
    $m = $room['matches'][$mid];
    $idx = rps_match_index($m, $id);
    $away = $now - $room['players'][$m['p'][1 - $idx]]['seen'];
    if ($away <= RPS_CLAIM_SECONDS) {
        throw new RpsError(sprintf(
            'Dein Gegner war vor %d s zuletzt da. Den Sieg kannst du erst nach %d s Abwesenheit beanspruchen.',
            max(0, $away),
            RPS_CLAIM_SECONDS
        ), 409);
    }
    return rps_room_put_match($room, $mid, rps_match_finish($m, $idx, 'claim'));
}

function rps_room_react(array $room, string $id, string $emoji, int $now): array
{
    rps_room_require_active($room, $id);
    $last = $room['players'][$id]['lastReact'];
    if ($last !== null && $now - $last < RPS_REACT_INTERVAL) {
        throw new RpsError('Nicht so schnell – höchstens eine Reaktion pro Sekunde.', 429);
    }
    $room['players'][$id]['lastReact'] = $now;
    $room['reactions'][] = ['id' => $room['nextReaction'], 'from' => $id, 'emoji' => $emoji, 't' => $now];
    $room['nextReaction']++;
    $room['reactions'] = array_slice($room['reactions'], -RPS_REACTIONS_KEEP);
    return $room;
}

/** Host-Rolle an den nächsten aktiven Spieler (Teilnehmer bevorzugt) übergeben. */
function rps_room_pass_host(array $room): array
{
    $active = rps_room_active_ids($room);
    $players = array_values(array_filter($active, static fn(string $p): bool => !$room['players'][$p]['spectator']));
    $room['host'] = $players[0] ?? $active[0] ?? null;
    return $room;
}

/** Beitritt: Duell oder Turnier. @return array{0:array,1:string,2:bool} [room, id, spectator] */
function rps_room_join(array $room, string $name, string $tokenHash, int $now): array
{
    return $room['type'] === 'duel'
        ? rps_duel_join($room, $name, $tokenHash, $now)
        : rps_tournament_join($room, $name, $tokenHash, $now);
}

function rps_room_leave(array $room, string $id): array
{
    if ($room['players'][$id]['left']) {
        return $room;
    }
    return $room['type'] === 'duel'
        ? rps_duel_leave($room, $id)
        : rps_tournament_leave($room, $id);
}

/** Spieler als gegangen markieren und sein laufendes Match dem Gegner geben. */
function rps_room_mark_left(array $room, string $id): array
{
    $room['players'][$id]['left'] = true;
    $mid = rps_room_my_match($room, $id);
    if ($mid !== null) {
        $m = $room['matches'][$mid];
        $room = rps_room_put_match($room, $mid, rps_match_finish($m, 1 - rps_match_index($m, $id), 'leave'));
    }
    if ($room['host'] === $id) {
        $room = rps_room_pass_host($room);
    }
    return $room;
}
