<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function test_duel_first_player_is_host_in_lobby(): void
{
    [$room, [$a]] = t_room('duel', 1);
    assert_same($a, $room['host']);
    assert_same('lobby', $room['status']);
    assert_same([], $room['matches']);
    assert_true((bool) preg_match('/^p_[23456789a-hj-km-np-z]{5}$/', $a), $a);
}

function test_duel_second_join_starts_match(): void
{
    [$room, [$a, $b]] = t_room('duel', 2, 5);
    assert_same('running', $room['status']);
    assert_same('m1', $room['current']);
    assert_same([$a, $b], $room['matches']['m1']['p']);
    assert_same(3, $room['matches']['m1']['target']);
    assert_same([$a => 0, $b => 0], $room['series']);
}

function test_duel_third_join_rejected(): void
{
    [$room] = t_room('duel', 2);
    [, $hash] = rps_new_token();
    assert_rps_error(static fn() => rps_room_join($room, 'Carl', $hash, T0), 409, 'voll');
}

function test_duel_duplicate_name_gets_suffix(): void
{
    [$room] = t_room('duel', 1);
    [, $hash] = rps_new_token();
    [$room, $b] = rps_room_join($room, 'spieler0', $hash, T0);
    assert_same('spieler0 2', $room['players'][$b]['name']);
}

function test_duel_find_player_by_token(): void
{
    [$room, [$a, $b], [$ta, $tb]] = t_room('duel', 2);
    assert_same($a, rps_room_find_player($room, $ta));
    assert_same($b, rps_room_find_player($room, $tb));
    [$other] = rps_new_token();
    assert_same(null, rps_room_find_player($room, $other));
    assert_rps_error(static fn() => rps_room_require_player($room, $other), 403);
    assert_true(!str_contains(json_encode($room), $ta), 'Token im Klartext gespeichert');
}

function test_duel_full_match_with_draw_and_series(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room = t_round($room, $a, $b, 'rock', 'rock');
    $room = t_round($room, $a, $b, 'rock', 'paper');
    $room = t_round($room, $a, $b, 'scissors', 'paper');
    $room = t_round($room, $a, $b, 'paper', 'rock');
    $m = $room['matches']['m1'];
    assert_same([2, 1], $m['score']);
    assert_same(4, count($m['history']));
    assert_same('score', $m['end']);
    assert_same([$a => 1, $b => 0], $room['series']);
    assert_same(null, rps_room_my_match($room, $a));
}

function test_duel_commit_without_running_match_rejected(): void
{
    [$room, [$a]] = t_room('duel', 1);
    [$h] = t_commit('rock');
    assert_rps_error(static fn() => rps_room_commit($room, $a, $h, T0), 409, 'kein Match');
}

function test_duel_rematch_needs_both_and_counts_series(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    assert_rps_error(static fn() => rps_duel_rematch($room, $a), 409, 'läuft noch');
    $room = t_win_match($room, 'm1', $b);
    $room = rps_duel_rematch($room, $a);
    $room = rps_duel_rematch($room, $a); // doppelt zählt nicht
    assert_same([$a], $room['rematch']);
    assert_same('m1', $room['current']);
    $room = rps_duel_rematch($room, $b);
    assert_same('m2', $room['current']);
    assert_same([], $room['rematch']);
    $room = t_win_match($room, 'm2', $b);
    assert_same([$a => 0, $b => 2], $room['series']);
}

function test_duel_keeps_limited_number_of_matches(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    for ($i = 1; $i <= RPS_DUEL_KEEP_MATCHES + 2; $i++) {
        $room = t_win_match($room, $room['current'], $a);
        $room = rps_duel_rematch(rps_duel_rematch($room, $a), $b);
    }
    assert_same(RPS_DUEL_KEEP_MATCHES, count($room['matches']));
    assert_true(isset($room['matches'][$room['current']]));
    assert_same(RPS_DUEL_KEEP_MATCHES + 2, $room['series'][$a]);
}

function test_duel_rematch_errors(): void
{
    [$lobby, [$a]] = t_room('duel', 1);
    assert_rps_error(static fn() => rps_duel_rematch($lobby, $a), 409, 'keine Revanche');
    [$t, [$x]] = t_room('tournament', 3);
    assert_rps_error(static fn() => rps_duel_rematch($t, $x), 400, 'nur im Duell');
}

function test_duel_leave_gives_match_to_opponent_and_closes_room(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room = t_round($room, $a, $b, 'rock', 'scissors');
    $room = rps_room_leave($room, $a);
    $m = $room['matches']['m1'];
    assert_same(1, $m['winner']);
    assert_same('leave', $m['end']);
    assert_same([$a => 0, $b => 1], $room['series']);
    assert_same('finished', $room['status']);
    assert_true($room['players'][$a]['left']);
    assert_same($b, $room['host']);
    assert_same($room, rps_room_leave($room, $a), 'zweites leave ist No-op');
    [, $hash] = rps_new_token();
    assert_rps_error(static fn() => rps_room_join($room, 'Neu', $hash, T0), 409, 'geschlossen');
    assert_rps_error(static fn() => rps_duel_rematch($room, $b), 409);
    assert_rps_error(static fn() => rps_room_react($room, $a, '👍', T0 + 5), 409, 'verlassen');
}

function test_duel_leave_in_lobby_closes_room(): void
{
    [$room, [$a]] = t_room('duel', 1);
    $room = rps_room_leave($room, $a);
    assert_same('finished', $room['status']);
    assert_same(null, $room['host']);
}

function test_duel_claim_after_absence(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $now = T0 + RPS_CLAIM_SECONDS;
    $room = rps_room_touch($room, $a, $now);
    assert_rps_error(static fn() => rps_room_claim($room, $a, $now), 409, '45 s');
    $later = T0 + RPS_CLAIM_SECONDS + 1;
    $room = rps_room_claim($room, $a, $later);
    $m = $room['matches']['m1'];
    assert_same(0, $m['winner']);
    assert_same('claim', $m['end']);
    assert_same(1, $room['series'][$a]);
    assert_rps_error(static fn() => rps_room_claim($room, $a, $later), 409, 'kein Match');
}

function test_duel_tick_forfeit_ends_match_and_counts_series(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room['matches']['m1']['target'] = 1;
    [$ha, $na] = t_commit('rock');
    [$hb] = t_commit('paper');
    $room = rps_room_commit(rps_room_commit($room, $a, $ha, T0), $b, $hb, T0);
    $room = rps_room_reveal($room, $a, 'rock', $na);
    assert_same($room, rps_room_tick($room, T0 + RPS_REVEAL_SECONDS));
    $room = rps_room_tick($room, T0 + RPS_REVEAL_SECONDS + 1);
    assert_same('forfeit', $room['matches']['m1']['end']);
    assert_same(1, $room['series'][$a]);
}

function test_room_react_rate_limit_and_cap(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room = rps_room_react($room, $a, '🔥', T0);
    assert_rps_error(static fn() => rps_room_react($room, $a, '👍', T0), 429, 'Sekunde');
    $room = rps_room_react($room, $b, '👍', T0);
    $room = rps_room_react($room, $a, '👍', T0 + RPS_REACT_INTERVAL);
    assert_same([1, 2, 3], array_column($room['reactions'], 'id'));
    assert_same(['id' => 1, 'from' => $a, 'emoji' => '🔥', 't' => T0], $room['reactions'][0]);
    for ($i = 0; $i < RPS_REACTIONS_KEEP + 5; $i++) {
        $room = rps_room_react($room, $a, '😈', T0 + 10 + $i);
    }
    assert_same(RPS_REACTIONS_KEEP, count($room['reactions']));
    assert_same(3 + RPS_REACTIONS_KEEP + 5, end($room['reactions'])['id']);
}

function test_room_online_and_seen(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $now = T0 + RPS_ONLINE_SECONDS;
    $room = rps_room_touch($room, $a, $now);
    assert_same([$a => true, $b => false], rps_room_online($room, $now));
    assert_true(!rps_room_seen_stale($room, $a, $now + RPS_SEEN_WRITE_SECONDS));
    assert_true(rps_room_seen_stale($room, $a, $now + RPS_SEEN_WRITE_SECONDS + 1));
    assert_same(rps_room_essence($room), rps_room_essence(rps_room_touch($room, $b, $now)));
}
