<?php
// Sicht eines Spielers auf den Raum (Antwort von `state`, Kurzfassung für `watch`). Keine geheimen Daten (Tokens, offene Züge).
declare(strict_types=1);

require_once __DIR__ . '/duel.php';
require_once __DIR__ . '/tournament.php';

function rps_room_view(array $room, string $code, int $version, string $me, int $now): array
{
    $isDuel = $room['type'] === 'duel';
    $matches = [];
    foreach ($room['matches'] as $mid => $m) {
        $matches[$mid] = rps_match_view((string) $mid, $m);
    }
    return [
        'version' => $version,
        'now' => $now,
        'code' => $code,
        'type' => $room['type'],
        'variant' => $room['variant'],
        'bestOf' => $room['bestOf'],
        'status' => $room['status'],
        'me' => $me,
        'host' => $room['host'],
        'players' => rps_room_players_view($room, $now),
        'matches' => (object) $matches,
        'current' => $isDuel ? $room['current'] : null,
        'myMatch' => rps_room_my_match($room, $me),
        'series' => (object) ($isDuel ? $room['series'] : []),
        'rematch' => $isDuel ? $room['rematch'] : [],
        'bracket' => $isDuel ? [] : $room['bracket'],
        'round' => $isDuel ? null : rps_tournament_round($room),
        'champion' => $room['champion'],
        'reactions' => $room['reactions'],
    ];
}

function rps_room_players_view(array $room, int $now): array
{
    $list = [];
    foreach ($room['order'] as $id) {
        $p = $room['players'][$id];
        $list[] = [
            'id' => $id,
            'name' => $p['name'],
            'online' => rps_player_online($p, $now),
            'spectator' => $p['spectator'],
            'left' => $p['left'],
        ];
    }
    return $list;
}

function rps_room_unchanged_view(array $room, int $version, int $now): array
{
    return [
        'version' => $version,
        'unchanged' => true,
        'now' => $now,
        'online' => (object) rps_room_online($room, $now),
    ];
}

/**
 * Öffentliche Rauminfo für die Einladungsseite (ohne Token): keine IDs, keine Tokens.
 * Im Turnier zusätzlich die Teilnehmernamen (in der Lobby ohnehin sichtbar).
 */
function rps_room_info(array $room, string $code): array
{
    $isDuel = $room['type'] === 'duel';
    $participants = $isDuel ? rps_room_active_ids($room) : rps_tournament_participants($room);
    $joinable = $isDuel
        ? $room['status'] === 'lobby' && count($room['order']) < RPS_DUEL_PLAYERS
        : $room['status'] === 'lobby' && count($participants) < RPS_TOURNAMENT_MAX;
    $roomFree = count($room['order']) < RPS_ROOM_MAX_PLAYERS;
    $info = [
        'code' => $code,
        'type' => $room['type'],
        'variant' => $room['variant'],
        'bestOf' => $room['bestOf'],
        'status' => $room['status'],
        'hostName' => $room['host'] === null ? null : $room['players'][$room['host']]['name'],
        'players' => count($participants),
        'maxPlayers' => $isDuel ? RPS_DUEL_PLAYERS : RPS_TOURNAMENT_MAX,
        'joinable' => $joinable && $roomFree,
        'spectate' => !$isDuel && !$joinable && $roomFree,
    ];
    if (!$isDuel) {
        $info['names'] = array_map(static fn(string $id): string => $room['players'][$id]['name'], $participants);
    }
    return $info;
}

/**
 * Kurzfassung eines Raums für „Meine Spiele“ (Antwort von `watch` je Raum). Enthält nie Züge,
 * Nonces, Hashes oder Tokens. Wer gegangen ist → {gone, reason: "left"}; bei since == version
 * nur {version, unchanged}.
 * @param int $updated Zeit der letzten Speicherung des Raums
 */
function rps_room_summary(array $room, int $version, string $me, int $updated, ?int $since = null): array
{
    $player = $room['players'][$me];
    if ($player['left']) {
        return ['gone' => true, 'reason' => 'left'];
    }
    if ($since === $version) {
        return ['version' => $version, 'unchanged' => true];
    }
    $isDuel = $room['type'] === 'duel';
    $myMatch = rps_room_my_match($room, $me);
    $match = $myMatch === null ? null : $room['matches'][$myMatch];
    $idx = $match === null ? null : rps_match_index($match, $me);
    $champion = $room['champion'] === null ? null : ($room['players'][$room['champion']]['name'] ?? null);
    return [
        'version' => $version,
        'type' => $room['type'],
        'variant' => $room['variant'],
        'bestOf' => $room['bestOf'],
        'status' => $room['status'],
        'me' => $me,
        'isHost' => $room['host'] === $me,
        'players' => count($isDuel ? rps_room_active_ids($room) : rps_tournament_participants($room)),
        'spectator' => $player['spectator'],
        'left' => false,
        'opponent' => rps_summary_opponent($room, $me, $match, $idx),
        'myMatch' => $myMatch,
        'needsMove' => $match !== null && $match['cur']['commit'][$idx] === null,
        'rematchWanted' => $isDuel && rps_summary_rematch_wanted($room, $me),
        'champion' => $champion,
        'updated' => $updated,
    ];
}

/** Duell: der andere Spieler (falls schon da); Turnier: Gegner im eigenen spielbaren Match. */
function rps_summary_opponent(array $room, string $me, ?array $match, ?int $idx): ?string
{
    if ($room['type'] === 'duel') {
        foreach ($room['order'] as $id) {
            if ($id !== $me) {
                return $room['players'][$id]['name'];
            }
        }
        return null;
    }
    return $match === null ? null : $room['players'][$match['p'][1 - $idx]]['name'];
}

/** Duell: aktuelles Match vorbei, Gegner will Revanche, ich noch nicht. */
function rps_summary_rematch_wanted(array $room, string $me): bool
{
    $current = $room['current'] === null ? null : ($room['matches'][$room['current']] ?? null);
    if ($room['status'] !== 'running' || $current === null || !rps_match_over($current)) {
        return false;
    }
    return $room['rematch'] !== [] && !in_array($me, $room['rematch'], true);
}
