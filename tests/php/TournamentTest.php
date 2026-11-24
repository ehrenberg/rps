<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function test_tournament_bracket_size(): void
{
    assert_same(4, rps_bracket_size(3));
    assert_same(4, rps_bracket_size(4));
    assert_same(8, rps_bracket_size(5));
    assert_same(16, rps_bracket_size(9));
    assert_same(16, rps_bracket_size(16));
}

function test_tournament_pairs_never_bye_vs_bye(): void
{
    for ($n = RPS_TOURNAMENT_MIN; $n <= RPS_TOURNAMENT_MAX; $n++) {
        $ids = array_map(static fn(int $i): string => "p_$i", range(1, $n));
        $pairs = rps_bracket_pairs($ids);
        assert_same(rps_bracket_size($n) / 2, count($pairs), "n=$n");
        $seen = [];
        foreach ($pairs as [$a, $b]) {
            assert_true($a !== null, "n=$n: Freilos gegen Freilos");
            $seen[] = $a;
            if ($b !== null) {
                $seen[] = $b;
            }
        }
        sort($seen);
        $expected = $ids;
        sort($expected);
        assert_same($expected, $seen, "n=$n: jeder Spieler genau einmal");
    }
}

function test_tournament_shuffle_is_permutation(): void
{
    $items = range(1, 16);
    $shuffled = rps_shuffle($items);
    sort($shuffled);
    assert_same($items, $shuffled);
}

function test_tournament_start_requires_host_and_min_players(): void
{
    [$room, [$a, $b]] = t_room('tournament', 2);
    assert_rps_error(static fn() => rps_tournament_start($room, $a), 409, 'mindestens 3');
    [$room, [$a, $b]] = t_room('tournament', 3);
    assert_rps_error(static fn() => rps_tournament_start($room, $b), 403, 'Host');
    [$duel, [$d]] = t_room('duel', 1);
    assert_rps_error(static fn() => rps_tournament_start($duel, $d), 400, 'nur im Turnier');
    $room = rps_tournament_start($room, $a);
    assert_rps_error(static fn() => rps_tournament_start($room, $a), 409, 'läuft schon');
}

function test_tournament_build_three_players(): void
{
    [$room, [$a]] = t_room('tournament', 3);
    $room = rps_tournament_start($room, $a);
    assert_same('running', $room['status']);
    assert_same([['m1', 'm2'], ['m3']], $room['bracket']);
    $byes = array_filter($room['matches'], static fn(array $m): bool => $m['end'] === 'bye');
    assert_same(1, count($byes));
    $bye = array_values($byes)[0];
    assert_same(null, $bye['p'][1]);
    assert_same(0, $bye['winner']);
    $final = $room['matches']['m3'];
    assert_same(['m1', 'm2'], $final['from']);
    // Freilos-Sieger ist schon ins Finale nachgerückt, der andere Platz ist noch offen.
    assert_true(in_array($bye['p'][0], $final['p'], true));
    assert_true(!rps_match_playable($final));
    assert_same(1, rps_tournament_round($room));
}

function test_tournament_runs_to_champion_for_various_sizes(): void
{
    foreach ([3 => 2, 4 => 2, 5 => 3, 8 => 3, 9 => 4, 16 => 4] as $n => $rounds) {
        [$room, $ids] = t_room('tournament', $n);
        $room = t_play_tournament($room, $ids[0]);
        assert_same('finished', $room['status'], "n=$n");
        assert_same($rounds, count($room['bracket']), "n=$n Runden");
        assert_same(rps_bracket_size($n) - 1, count($room['matches']), "n=$n Matches");
        assert_true(in_array($room['champion'], $ids, true), "n=$n Champion");
        $final = $room['matches'][$room['bracket'][$rounds - 1][0]];
        assert_same($room['champion'], $final['p'][$final['winner']]);
        assert_same($rounds, rps_tournament_round($room));
        $byes = count(array_filter($room['matches'], static fn(array $m): bool => $m['end'] === 'bye'));
        assert_same(rps_bracket_size($n) - $n, $byes, "n=$n Freilose");
    }
}

function test_tournament_next_match_starts_before_round_completes(): void
{
    [$room, [$a]] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $a);
    $m1 = $room['matches']['m1'];
    $room = t_win_match($room, 'm1', $m1['p'][0]);
    assert_same([$m1['p'][0], null], $room['matches']['m3']['p']);
    assert_same(null, rps_room_my_match($room, $m1['p'][0]), 'Finale noch nicht spielbar');
    $m2 = $room['matches']['m2'];
    $room = t_win_match($room, 'm2', $m2['p'][1]);
    assert_same([$m1['p'][0], $m2['p'][1]], $room['matches']['m3']['p']);
    assert_same('m3', rps_room_my_match($room, $m1['p'][0]));
    assert_same(2, rps_tournament_round($room));
}

function test_tournament_join_lobby_full_and_running_become_spectators(): void
{
    [$room, $ids] = t_room('tournament', RPS_TOURNAMENT_MAX);
    [, $hash] = rps_new_token();
    [$room, $extra, $spectator] = rps_room_join($room, 'Extra', $hash, T0);
    assert_true($spectator, '17. in der Lobby ist Zuschauer');
    $room = rps_tournament_start($room, $ids[0]);
    [, $hash2] = rps_new_token();
    [$room, $late, $spec2] = rps_room_join($room, 'Spät', $hash2, T0);
    assert_true($spec2);
    assert_same(null, rps_room_my_match($room, $late));
    // Zuschauer dürfen reagieren, aber nicht spielen.
    $room = rps_room_react($room, $late, '👏', T0);
    [$h] = t_commit('rock');
    assert_rps_error(static fn() => rps_room_commit($room, $late, $h, T0), 409);
}

function test_tournament_room_player_cap(): void
{
    [$room] = t_room('tournament', RPS_ROOM_MAX_PLAYERS);
    [, $hash] = rps_new_token();
    assert_rps_error(static fn() => rps_room_join($room, 'Zu viel', $hash, T0), 409, 'voll');
}

function test_tournament_restart_with_spectators(): void
{
    [$room, $ids] = t_room('tournament', 3);
    $room = rps_tournament_start($room, $ids[0]);
    [, $hash] = rps_new_token();
    [$room, $spec] = rps_room_join($room, 'Zuschauer', $hash, T0);
    $room = t_finish_tournament($room);
    assert_same('finished', $room['status']);
    assert_rps_error(static fn() => rps_tournament_start($room, $ids[1]), 403, 'Host');
    $room = rps_tournament_start($room, $ids[0]);
    assert_same('running', $room['status']);
    assert_true(!$room['players'][$spec]['spectator'], 'Zuschauer wird Teilnehmer');
    assert_same(null, $room['champion']);
    assert_same(3, count($room['matches']), '4 Spieler → 3 Matches');
    assert_same(['m4', 'm5'], $room['bracket'][0], 'Match-IDs laufen im Raum weiter');
}

function test_tournament_restart_caps_participants(): void
{
    [$room, $ids] = t_room('tournament', RPS_TOURNAMENT_MAX + 2);
    $room = t_play_tournament($room, $ids[0]);
    $room = rps_tournament_start($room, $ids[0]);
    assert_same(RPS_TOURNAMENT_MAX, count(rps_tournament_participants($room)));
    assert_true($room['players'][$ids[RPS_TOURNAMENT_MAX + 1]]['spectator']);
}

function test_tournament_restart_drops_left_players(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = t_play_tournament($room, $ids[0]);
    $room = rps_room_leave($room, $ids[3]);
    $room = rps_tournament_start($room, $ids[0]);
    assert_true(!isset($room['players'][$ids[3]]));
    assert_same(3, count($room['order']));
    assert_same(3, count($room['matches']));
}

function test_tournament_leave_in_lobby_removes_player_and_passes_host(): void
{
    [$room, $ids] = t_room('tournament', 3);
    $room = rps_room_leave($room, $ids[0]);
    assert_same([$ids[1], $ids[2]], $room['order']);
    assert_same($ids[1], $room['host']);
    assert_rps_error(static fn() => rps_tournament_start($room, $ids[1]), 409, 'mindestens');
}

function test_tournament_leave_running_loses_current_and_future_matches(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    [$x, $y] = $room['matches']['m1']['p'];
    [$u, $v] = $room['matches']['m2']['p'];
    // x gewinnt m1, verlässt dann das Turnier → verliert das Finale automatisch.
    $room = t_win_match($room, 'm1', $x);
    $room = rps_room_leave($room, $x);
    assert_same('running', $room['status']);
    // v verlässt mitten im Match m2 → u gewinnt m2 mit „leave“.
    $room = rps_room_leave($room, $v);
    assert_same('leave', $room['matches']['m2']['end']);
    assert_same($u, $room['matches']['m2']['p'][$room['matches']['m2']['winner']]);
    $final = $room['matches']['m3'];
    assert_same('leave', $final['end']);
    assert_same($u, $room['champion']);
    assert_same('finished', $room['status']);
}

function test_tournament_last_remaining_player_becomes_champion(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    [$a, $b] = $room['matches']['m1']['p'];
    [$c, $d] = $room['matches']['m2']['p'];
    foreach ([$a, $b, $c] as $pid) {
        $room = rps_room_leave($room, $pid);
    }
    assert_same('finished', $room['status']);
    assert_same($d, $room['champion']);
}

function test_tournament_settle_handles_matches_without_winner(): void
{
    // Defensiv: Vorgänger ohne Sieger (beide gegangen) → Platz leer; zwei leere Plätze → kein Sieger.
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    foreach ($room['matches']['m1']['p'] as $pid) {
        $room['players'][$pid]['left'] = true;
    }
    $room['matches']['m1'] = rps_match_finish($room['matches']['m1'], null, 'leave');
    $room['matches']['m2'] = rps_match_finish($room['matches']['m2'], null, 'leave');
    $room = rps_tournament_settle($room);
    assert_same('bye', $room['matches']['m3']['end']);
    assert_same(null, $room['matches']['m3']['winner']);
    assert_same(null, $room['champion']);
    assert_same('finished', $room['status']);
}

function test_tournament_settle_both_present_players_left(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    $w1 = $room['matches']['m1']['p'][0];
    $w2 = $room['matches']['m2']['p'][0];
    $room['matches']['m1'] = rps_match_finish($room['matches']['m1'], 0, 'score');
    $room['matches']['m2'] = rps_match_finish($room['matches']['m2'], 0, 'score');
    $room['players'][$w1]['left'] = true;
    $room['players'][$w2]['left'] = true;
    $room = rps_tournament_settle($room);
    assert_same('leave', $room['matches']['m3']['end']);
    assert_same(null, $room['champion']);
}

function test_tournament_settle_empty_slot_gives_bye(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    $w1 = $room['matches']['m1']['p'][0];
    $room['matches']['m1'] = rps_match_finish($room['matches']['m1'], 0, 'score');
    $room['matches']['m2'] = rps_match_finish($room['matches']['m2'], null, 'leave');
    $room = rps_tournament_settle($room);
    assert_same('bye', $room['matches']['m3']['end']);
    assert_same($w1, $room['champion']);
}

function test_tournament_settle_left_player_with_empty_slot(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    $w1 = $room['matches']['m1']['p'][0];
    $room['matches']['m1'] = rps_match_finish($room['matches']['m1'], 0, 'score');
    $room['matches']['m2'] = rps_match_finish($room['matches']['m2'], null, 'leave');
    $room['players'][$w1]['left'] = true;
    $room = rps_tournament_settle($room);
    assert_same('leave', $room['matches']['m3']['end']);
    assert_same(null, $room['matches']['m3']['winner']);
}

function test_tournament_left_winner_loses_next_match(): void
{
    // 8er-Baum: b gewinnt m1 durch leave, geht dann selbst → verliert m5 automatisch.
    [$room, $ids] = t_room('tournament', 8);
    $room = rps_tournament_start($room, $ids[0]);
    [$a, $b] = $room['matches']['m1']['p'];
    $room = rps_room_leave($room, $a);           // b gewinnt m1 durch leave
    $room = rps_room_leave($room, $b);           // b ist nun auch weg
    assert_same('leave', $room['matches']['m1']['end']);
    $w = $room['matches']['m2']['p'][0];
    $room = t_win_match($room, 'm2', $w);
    $m5 = $room['matches']['m5'];
    assert_same('leave', $m5['end'], 'b war gegangen → verliert m5');
    assert_same($w, $m5['p'][$m5['winner']]);
}

function test_tournament_host_leaves_running_passes_host(): void
{
    [$room, $ids] = t_room('tournament', 3);
    $room = rps_tournament_start($room, $ids[0]);
    $room = rps_room_leave($room, $ids[0]);
    assert_true($room['host'] !== $ids[0]);
    assert_true(!$room['players'][$room['host']]['left']);
}

function test_tournament_claim_in_tournament(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    [$x, $y] = $room['matches']['m1']['p'];
    $now = T0 + RPS_CLAIM_SECONDS + 1;
    $room = rps_room_claim(rps_room_touch($room, $x, $now), $x, $now);
    assert_same('claim', $room['matches']['m1']['end']);
    assert_same([$x, null], $room['matches']['m3']['p']);
}

function test_tournament_round_null_in_lobby(): void
{
    [$room] = t_room('tournament', 3);
    assert_same(null, rps_tournament_round($room));
}

function test_tournament_deadline_forfeit_advances_bracket(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    $room['matches']['m1']['target'] = 1;
    [$x, $y] = $room['matches']['m1']['p'];
    [$hx, $nx] = t_commit('rock');
    [$hy] = t_commit('paper');
    $room = rps_room_commit(rps_room_commit($room, $x, $hx, T0), $y, $hy, T0);
    $room = rps_room_reveal($room, $x, 'rock', $nx);
    $room = rps_room_tick($room, T0 + RPS_REVEAL_SECONDS + 1);
    assert_same('forfeit', $room['matches']['m1']['end']);
    assert_same([$x, null], $room['matches']['m3']['p']);
}

function test_tournament_commit_deadline_unblocks_bracket(): void
{
    [$room, $ids] = t_room('tournament', 4);
    $room = rps_tournament_start($room, $ids[0]);
    $room['matches']['m1']['target'] = 1;
    [$x] = $room['matches']['m1']['p'];
    [$h] = t_commit('rock');
    $room = rps_room_commit($room, $x, $h, T0);
    $room = rps_room_tick($room, T0 + RPS_COMMIT_SECONDS + 1);
    assert_same('forfeit', $room['matches']['m1']['end']);
    assert_same([$x, null], $room['matches']['m3']['p']);
}
