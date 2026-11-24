<?php
// Online-Duell: zwei Spieler, Revanche, Serie. Reine Funktionen auf Raum-Arrays.
declare(strict_types=1);

require_once __DIR__ . '/room.php';

const RPS_DUEL_PLAYERS = 2;
const RPS_DUEL_KEEP_MATCHES = 5;   // ältere, beendete Matches werden verworfen

/** @return array{0:array,1:string,2:bool} */
function rps_duel_join(array $room, string $name, string $tokenHash, int $now): array
{
    if ($room['status'] === 'finished') {
        throw new RpsError('Dieser Raum ist geschlossen. Erstelle einfach einen neuen.', 409);
    }
    if (count($room['order']) >= RPS_DUEL_PLAYERS) {
        throw new RpsError('Dieser Raum ist schon voll.', 409);
    }
    [$room, $id] = rps_room_add_player($room, $name, $tokenHash, $now, false);
    if (count($room['order']) === RPS_DUEL_PLAYERS) {
        $room['series'] = array_fill_keys($room['order'], 0);
        $room['status'] = 'running';
        $room = rps_duel_new_match($room);
    }
    return [$room, $id, false];
}

function rps_duel_new_match(array $room): array
{
    [$room, $mid] = rps_room_next_match_id($room);
    $room['matches'][$mid] = rps_match_new($room['order'][0], $room['order'][1], rps_target_wins($room['bestOf']));
    $room['current'] = $mid;
    $room['rematch'] = [];
    $room['matches'] = array_slice($room['matches'], -RPS_DUEL_KEEP_MATCHES, null, true);
    return $room;
}

function rps_duel_on_match_end(array $room, string $mid): array
{
    $m = $room['matches'][$mid];
    if ($m['winner'] !== null) {
        $room['series'][$m['p'][$m['winner']]]++;
    }
    return $room;
}

function rps_duel_rematch(array $room, string $id): array
{
    if ($room['type'] !== 'duel') {
        throw new RpsError('Revanche gibt es nur im Duell.', 400);
    }
    rps_room_require_active($room, $id);
    if ($room['status'] !== 'running' || $room['current'] === null) {
        throw new RpsError('Gerade ist keine Revanche möglich.', 409);
    }
    if (!rps_match_over($room['matches'][$room['current']])) {
        throw new RpsError('Das Match läuft noch.', 409);
    }
    if (!in_array($id, $room['rematch'], true)) {
        $room['rematch'][] = $id;
    }
    return count($room['rematch']) === RPS_DUEL_PLAYERS ? rps_duel_new_match($room) : $room;
}

/** Wer geht, verliert das laufende Match; der Raum ist danach geschlossen. */
function rps_duel_leave(array $room, string $id): array
{
    $room = rps_room_mark_left($room, $id);
    $room['status'] = 'finished';
    $room['rematch'] = [];
    return $room;
}
