<?php
// rps_room_summary (Antwort von `watch` je Raum) – rein, ohne DB.
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const T_SUMMARY_KEYS = ['version', 'type', 'variant', 'bestOf', 'status', 'me', 'isHost', 'players', 'spectator',
    'left', 'opponent', 'myMatch', 'needsMove', 'rematchWanted', 'champion', 'updated'];

function test_summary_duel_lobby(): void
{
    [$room, [$a]] = t_room('duel', 1, 5, 'lizard');
    $s = rps_room_summary($room, 1, $a, T0 + 7);
    assert_same(T_SUMMARY_KEYS, array_keys($s));
    assert_same([
        'version' => 1, 'type' => 'duel', 'variant' => 'lizard', 'bestOf' => 5, 'status' => 'lobby',
        'me' => $a, 'isHost' => true, 'players' => 1, 'spectator' => false, 'left' => false,
        'opponent' => null, 'myMatch' => null, 'needsMove' => false, 'rematchWanted' => false,
        'champion' => null, 'updated' => T0 + 7,
    ], $s);
}

function test_summary_running_duel_needs_move(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $sa = rps_room_summary($room, 2, $a, T0);
    assert_same(['running', 2, 'Spieler1', 'm1', true, true], [$sa['status'], $sa['players'], $sa['opponent'], $sa['myMatch'], $sa['needsMove'], $sa['isHost']]);
    $sb = rps_room_summary($room, 2, $b, T0);
    assert_same(['Spieler0', false, true], [$sb['opponent'], $sb['isHost'], $sb['needsMove']]);
    // A hat gewählt → A wartet, B ist dran.
    $room = rps_room_commit($room, $a, t_commit('rock')[0], T0);
    assert_same(false, rps_room_summary($room, 3, $a, T0)['needsMove']);
    assert_same(true, rps_room_summary($room, 3, $b, T0)['needsMove']);
    // Beide gewählt (Aufdecken läuft automatisch) → keiner muss wählen.
    $room = rps_room_commit($room, $b, t_commit('paper')[0], T0);
    assert_same([false, false], [rps_room_summary($room, 4, $a, T0)['needsMove'], rps_room_summary($room, 4, $b, T0)['needsMove']]);
}

function test_summary_rematch_wanted(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    $room = t_win_match($room, 'm1', $a);
    $sa = rps_room_summary($room, 9, $a, T0);
    assert_same([null, false, false], [$sa['myMatch'], $sa['needsMove'], $sa['rematchWanted']]);
    $room = rps_duel_rematch($room, $b);
    assert_same(true, rps_room_summary($room, 10, $a, T0)['rematchWanted']);
    assert_same(false, rps_room_summary($room, 10, $b, T0)['rematchWanted'], 'eigener Wunsch zählt nicht');
    $room = rps_duel_rematch($room, $a);
    $sa = rps_room_summary($room, 11, $a, T0);
    assert_same(['m2', true, false], [$sa['myMatch'], $sa['needsMove'], $sa['rematchWanted']]);
}

function test_summary_tournament_with_and_without_match(): void
{
    [$room, $ids] = t_room('tournament', 5);
    $lobby = rps_room_summary($room, 5, $ids[1], T0);
    assert_same(
        ['tournament', 'lobby', 5, false, null, null],
        [$lobby['type'], $lobby['status'], $lobby['players'], $lobby['isHost'], $lobby['opponent'], $lobby['myMatch']]
    );
    $room = rps_tournament_start($room, $ids[0]);
    $with = $without = 0;
    foreach ($ids as $id) {
        $s = rps_room_summary($room, 6, $id, T0);
        $mid = rps_room_my_match($room, $id);
        assert_same($mid, $s['myMatch']);
        if ($mid === null) {
            $without++;
            assert_same([null, false], [$s['opponent'], $s['needsMove']]);
            continue;
        }
        $with++;
        $m = $room['matches'][$mid];
        $other = $m['p'][0] === $id ? $m['p'][1] : $m['p'][0];
        assert_same([$room['players'][$other]['name'], true], [$s['opponent'], $s['needsMove']]);
    }
    assert_true($with >= 2 && $without >= 1, "mit Match: $with, ohne: $without");
}

function test_summary_spectator_and_champion(): void
{
    [$room, $ids] = t_room('tournament', 3);
    $room = rps_tournament_start($room, $ids[0]);
    [, $hash] = rps_new_token();
    [$room, $spec] = rps_room_join($room, 'Gast', $hash, T0);
    $s = rps_room_summary($room, 7, $spec, T0);
    assert_same([true, null, false, 3, null], [$s['spectator'], $s['myMatch'], $s['needsMove'], $s['players'], $s['champion']]);
    $room = t_finish_tournament($room);
    $s = rps_room_summary($room, 20, $spec, T0);
    assert_same('finished', $s['status']);
    assert_true($room['champion'] !== null);
    assert_same($room['players'][$room['champion']]['name'], $s['champion']);
}

function test_summary_left_and_unchanged(): void
{
    [$room, [$a, $b]] = t_room('duel', 2);
    assert_same(['version' => 4, 'unchanged' => true], rps_room_summary($room, 4, $a, T0, 4));
    assert_same('duel', rps_room_summary($room, 4, $a, T0, 3)['type']);
    $room = rps_room_leave($room, $b);
    assert_same(['gone' => true, 'reason' => 'left'], rps_room_summary($room, 5, $b, T0));
    assert_same(['gone' => true, 'reason' => 'left'], rps_room_summary($room, 5, $b, T0, 5), 'left vor unchanged');
    $sa = rps_room_summary($room, 5, $a, T0);
    assert_same(
        ['finished', 1, 'Spieler1', false, false],
        [$sa['status'], $sa['players'], $sa['opponent'], $sa['needsMove'], $sa['rematchWanted']]
    );
}

function test_summary_fairness_no_secrets(): void
{
    [$room, [$a, $b], [$ta, $tb]] = t_room('duel', 2, 3, 'lizard');
    [$ha, $na] = t_commit('spock');
    [$hb, $nb] = t_commit('paper');
    $room = rps_room_commit($room, $a, $ha, T0);
    $room = rps_room_commit($room, $b, $hb, T0);
    $room = rps_room_reveal($room, $a, 'spock', $na);
    // Abgeschlossene Runde in der history; danach ein offener Commit.
    $room = rps_room_reveal($room, $b, 'paper', $nb);
    [$ha2, $na2] = t_commit('rock');
    $room = rps_room_commit($room, $a, $ha2, T0);
    foreach ([$a, $b] as $viewer) {
        $json = json_encode(rps_room_summary($room, 6, $viewer, T0));
        foreach (['spock', 'paper', 'rock', $na, $nb, $na2, $ha, $hb, $ha2, $ta, $tb, 'tokenHash', 'history', 'nonce', 'commit'] as $secret) {
            assert_true(!str_contains($json, $secret), "Summary enthält „{$secret}“: $json");
        }
    }
}
