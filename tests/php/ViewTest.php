<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const T_VIEW_KEYS = ['version', 'now', 'code', 'type', 'variant', 'bestOf', 'status', 'me', 'host', 'players',
    'matches', 'current', 'myMatch', 'series', 'rematch', 'bracket', 'round', 'champion', 'reactions'];
const T_MATCH_KEYS = ['id', 'p', 'score', 'target', 'cur', 'history', 'dropped', 'winner', 'end', 'from'];

function test_view_fairness_no_move_before_both_revealed(): void
{
    [$room, [$a, $b], [$ta]] = t_room('duel', 2, 3, 'lizard');
    [$ha, $na] = t_commit('spock');
    [$hb, $nb] = t_commit('lizard');
    $room = rps_room_commit($room, $a, $ha, T0);
    foreach ([$a, $b] as $viewer) {
        $json = json_encode(rps_room_view($room, 'k7f3qa', 2, $viewer, T0));
        assert_true(!str_contains($json, 'spock') && !str_contains($json, $na), 'nach Commit');
    }
    $room = rps_room_commit($room, $b, $hb, T0);
    $room = rps_room_reveal($room, $a, 'spock', $na);
    foreach ([$a, $b] as $viewer) {
        $json = json_encode(rps_room_view($room, 'k7f3qa', 3, $viewer, T0));
        assert_true(!str_contains($json, '"spock"'), 'Zug nach einseitigem Reveal sichtbar');
        assert_true(!str_contains($json, $na), 'Nonce nach einseitigem Reveal sichtbar');
        assert_true(!str_contains($json, $ta), 'Token sichtbar');
        assert_true(!str_contains($json, 'tokenHash'), 'tokenHash sichtbar');
    }
    $room = rps_room_reveal($room, $b, 'lizard', $nb);
    $v = rps_room_view($room, 'k7f3qa', 4, $b, T0);
    assert_same(['spock', 'lizard'], $v['matches']->m1['history'][0]['m']);
    assert_same([$na, $nb], $v['matches']->m1['history'][0]['n']);
    assert_same([$ha, $hb], $v['matches']->m1['history'][0]['h']);
}

function test_view_duel_shape(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room = rps_room_react($room, $b, '🤝', T0);
    $v = rps_room_view($room, 'k7f3qa', 5, $a, T0 + 1);
    assert_same(T_VIEW_KEYS, array_keys($v));
    assert_same(5, $v['version']);
    assert_same(T0 + 1, $v['now']);
    assert_same('duel', $v['type']);
    assert_same('running', $v['status']);
    assert_same($a, $v['me']);
    assert_same('m1', $v['current']);
    assert_same('m1', $v['myMatch']);
    assert_same([], $v['bracket']);
    assert_same(null, $v['round']);
    assert_same([$a => 0, $b => 0], (array) $v['series']);
    assert_same(
        ['id' => $a, 'name' => 'Spieler0', 'online' => true, 'spectator' => false, 'left' => false],
        $v['players'][0]
    );
    assert_same(T_MATCH_KEYS, array_keys($v['matches']->m1));
    assert_same(null, $v['matches']->m1['from']);
    assert_same('🤝', $v['reactions'][0]['emoji']);
}

function test_view_empty_maps_encode_as_objects(): void
{
    [$room, [$a]] = t_room('duel', 1);
    $json = json_encode(rps_room_view($room, 'k7f3qa', 1, $a, T0));
    assert_true(str_contains($json, '"matches":{}'), $json);
    assert_true(str_contains($json, '"series":{}'), $json);
    assert_true(str_contains($json, '"current":null'), $json);
}

function test_view_tournament_shape(): void
{
    [$room, $ids] = t_room('tournament', 5);
    $room = rps_tournament_start($room, $ids[0]);
    $v = rps_room_view($room, 'k7f3qa', 9, $ids[1], T0);
    assert_same(null, $v['current']);
    assert_same([], (array) $v['series']);
    assert_same([], $v['rematch']);
    assert_same(3, count($v['bracket']));
    assert_same(1, $v['round']);
    $final = (array) $v['matches'];
    $finalId = $v['bracket'][2][0];
    assert_same($v['bracket'][1], $final[$finalId]['from']);
    $mine = $v['myMatch'];
    if ($mine !== null) {
        assert_true(in_array($ids[1], $final[$mine]['p'], true));
    }
}

function test_view_online_flags_and_unchanged(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $now = T0 + RPS_ONLINE_SECONDS;
    $room = rps_room_touch($room, $a, $now);
    $room = rps_room_leave($room, $b);
    $u = rps_room_unchanged_view($room, 7, $now);
    assert_same(['version' => 7, 'unchanged' => true, 'now' => $now], array_slice($u, 0, 3));
    assert_same([$a => true, $b => false], (array) $u['online']);
    $v = rps_room_view($room, 'k7f3qa', 7, $b, $now);
    assert_same(true, $v['players'][1]['left']);
}

function test_view_info_duel(): void
{
    [$room] = t_room('duel', 1, 5, 'lizard');
    $info = rps_room_info($room, 'k7f3qa');
    assert_same([
        'code' => 'k7f3qa', 'type' => 'duel', 'variant' => 'lizard', 'bestOf' => 5, 'status' => 'lobby',
        'hostName' => 'Spieler0', 'players' => 1, 'maxPlayers' => RPS_DUEL_PLAYERS,
        'joinable' => true, 'spectate' => false,
    ], $info);
    [$full, [$a]] = t_room('duel', 2);
    $info = rps_room_info($full, 'k7f3qa');
    assert_same([false, false, 2], [$info['joinable'], $info['spectate'], $info['players']]);
    $closed = rps_room_leave($full, $a);
    $info = rps_room_info($closed, 'k7f3qa');
    assert_same(['finished', false, false, 1], [$info['status'], $info['joinable'], $info['spectate'], $info['players']]);
}

function test_view_info_tournament(): void
{
    [$room, $ids, $tokens] = t_room('tournament', 3);
    $info = rps_room_info($room, 'k7f3qa');
    assert_same(['Spieler0', 'Spieler1', 'Spieler2'], $info['names']);
    assert_same([3, RPS_TOURNAMENT_MAX, true, false], [$info['players'], $info['maxPlayers'], $info['joinable'], $info['spectate']]);
    $json = json_encode($info);
    foreach ($ids as $i => $id) {
        assert_true(!str_contains($json, $id) && !str_contains($json, $tokens[$i]), 'ID/Token in info');
    }
    assert_true(!str_contains($json, 'tokenHash'));
    $running = rps_tournament_start($room, $ids[0]);
    $info = rps_room_info($running, 'k7f3qa');
    assert_same(['running', false, true], [$info['status'], $info['joinable'], $info['spectate']]);
    // Lobby mit 16 Teilnehmern: nur noch Zuschauer.
    [$fullLobby] = t_room('tournament', RPS_TOURNAMENT_MAX);
    $info = rps_room_info($fullLobby, 'k7f3qa');
    assert_same([false, true], [$info['joinable'], $info['spectate']]);
    // Raum komplett voll: weder noch.
    [$packed] = t_room('tournament', RPS_ROOM_MAX_PLAYERS);
    $info = rps_room_info($packed, 'k7f3qa');
    assert_same([false, false, RPS_TOURNAMENT_MAX], [$info['joinable'], $info['spectate'], $info['players']]);
}

function test_view_info_without_host(): void
{
    [$room, [$a]] = t_room('tournament', 1);
    $room = rps_room_leave($room, $a);
    assert_same(null, rps_room_info($room, 'k7f3qa')['hostName']);
    assert_same([], rps_room_info($room, 'k7f3qa')['names']);
}
