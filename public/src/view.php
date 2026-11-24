<?php
// Sicht eines Spielers auf den Raum (Antwort von `state`). Keine geheimen Daten (Tokens, offene Züge).
declare(strict_types=1);

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
