<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/** Beide committen, liefert [match, [nonceA, nonceB]]. */
function t_match_locked(string $a, string $b, int $now = T0): array
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$ha, $na] = t_commit($a);
    [$hb, $nb] = t_commit($b);
    $m = rps_match_commit($m, 0, $ha, $now);
    $m = rps_match_commit($m, 1, $hb, $now);
    return [$m, [$na, $nb]];
}

function test_match_commit_locks_when_both_committed(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h] = t_commit('rock');
    $m = rps_match_commit($m, 0, $h, T0);
    assert_same(null, $m['cur']['lockedAt']);
    [$h2] = t_commit('paper');
    $m = rps_match_commit($m, 1, $h2, T0 + 3);
    assert_same(T0 + 3, $m['cur']['lockedAt']);
}

function test_match_commit_twice_rejected(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h] = t_commit('rock');
    $m = rps_match_commit($m, 0, $h, T0);
    [$h2] = t_commit('paper');
    assert_rps_error(static fn() => rps_match_commit($m, 0, $h2, T0), 409, 'schon gewählt');
}

function test_match_commit_copying_opponent_hash_rejected(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h] = t_commit('rock');
    $m = rps_match_commit($m, 0, $h, T0);
    assert_rps_error(static fn() => rps_match_commit($m, 1, $h, T0), 400);
}

function test_match_commit_rejected_when_not_playable(): void
{
    [$h] = t_commit('rock');
    $placeholder = rps_match_new('p_a', null, 2, ['m1', 'm2']);
    assert_rps_error(static fn() => rps_match_commit($placeholder, 0, $h, T0), 409, 'läuft gerade nicht');
    $over = rps_match_finish(rps_match_new('p_a', 'p_b', 2), 0, 'claim');
    assert_rps_error(static fn() => rps_match_commit($over, 0, $h, T0), 409);
}

function test_match_reveal_requires_lock(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h, $n] = t_commit('rock');
    $m = rps_match_commit($m, 0, $h, T0);
    assert_rps_error(static fn() => rps_match_reveal($m, 0, 'rock', $n, 'classic'), 409, 'nichts aufzudecken');
}

function test_match_reveal_wrong_hash_rejected(): void
{
    [$m, [$na]] = t_match_locked('rock', 'paper');
    assert_rps_error(static fn() => rps_match_reveal($m, 0, 'paper', $na, 'classic'), 400, 'passt nicht');
    assert_rps_error(static fn() => rps_match_reveal($m, 0, 'rock', str_repeat('0', 32), 'classic'), 400, 'passt nicht');
}

function test_match_reveal_invalid_move_for_variant(): void
{
    [$m, [$na]] = t_match_locked('lizard', 'paper');
    assert_rps_error(static fn() => rps_match_reveal($m, 0, 'lizard', $na, 'classic'), 400, 'Variante');
    $ok = rps_match_reveal($m, 0, 'lizard', $na, 'lizard');
    assert_same('lizard', $ok['cur']['move'][0]);
}

function test_match_reveal_twice_rejected(): void
{
    [$m, [$na]] = t_match_locked('rock', 'paper');
    $m = rps_match_reveal($m, 0, 'rock', $na, 'classic');
    assert_rps_error(static fn() => rps_match_reveal($m, 0, 'rock', $na, 'classic'), 409, 'schon aufgedeckt');
}

function test_match_full_round_scores_and_records_history(): void
{
    [$m, [$na, $nb]] = t_match_locked('rock', 'scissors');
    $commits = $m['cur']['commit'];
    $m = rps_match_reveal($m, 1, 'scissors', $nb, 'classic');
    $m = rps_match_reveal($m, 0, 'rock', $na, 'classic');
    assert_same([1, 0], $m['score']);
    assert_same(
        [['m' => ['rock', 'scissors'], 'n' => [$na, $nb], 'h' => $commits, 'w' => 0, 'f' => false]],
        $m['history']
    );
    assert_same(rps_round_new(), $m['cur']);
    assert_same(null, $m['winner']);
}

function test_match_draw_repeats_round(): void
{
    [$m, [$na, $nb]] = t_match_locked('paper', 'paper');
    $m = rps_match_reveal($m, 0, 'paper', $na, 'classic');
    $m = rps_match_reveal($m, 1, 'paper', $nb, 'classic');
    assert_same([0, 0], $m['score']);
    assert_same(-1, $m['history'][0]['w']);
    assert_same(null, $m['end']);
}

function test_match_ends_at_target(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    foreach ([['paper', 'rock'], ['rock', 'paper'], ['scissors', 'paper']] as [$a, $b]) {
        [$ha, $na] = t_commit($a);
        [$hb, $nb] = t_commit($b);
        $m = rps_match_commit(rps_match_commit($m, 0, $ha, T0), 1, $hb, T0);
        $m = rps_match_reveal(rps_match_reveal($m, 0, $a, $na, 'classic'), 1, $b, $nb, 'classic');
    }
    assert_same([2, 1], $m['score']);
    assert_same(0, $m['winner']);
    assert_same('score', $m['end']);
    assert_true(!rps_match_playable($m));
}

function test_match_tick_before_deadline_changes_nothing(): void
{
    [$m] = t_match_locked('rock', 'paper');
    assert_same($m, rps_match_tick($m, T0 + RPS_REVEAL_SECONDS));
    $fresh = rps_match_new('p_a', 'p_b', 2);
    assert_same($fresh, rps_match_tick($fresh, T0 + 9999));
}

function test_match_tick_forfeits_non_revealer(): void
{
    [$m, [, $nb]] = t_match_locked('rock', 'paper');
    $m = rps_match_reveal($m, 1, 'paper', $nb, 'classic');
    $m = rps_match_tick($m, T0 + RPS_REVEAL_SECONDS + 1);
    assert_same([0, 1], $m['score']);
    $h = $m['history'][0];
    assert_same([null, 'paper'], $h['m']);
    assert_same([null, $nb], $h['n']);
    assert_same(1, $h['w']);
    assert_true($h['f']);
    assert_same(null, $m['cur']['lockedAt']);
}

function test_match_tick_forfeit_can_end_match(): void
{
    $m = rps_match_new('p_a', 'p_b', 1);
    [$ha, $na] = t_commit('rock');
    [$hb] = t_commit('paper');
    $m = rps_match_commit(rps_match_commit($m, 0, $ha, T0), 1, $hb, T0);
    $m = rps_match_reveal($m, 0, 'rock', $na, 'classic');
    $m = rps_match_tick($m, T0 + 100);
    assert_same(0, $m['winner']);
    assert_same('forfeit', $m['end']);
}

function test_match_tick_neither_revealed_restarts_round(): void
{
    [$m] = t_match_locked('rock', 'paper');
    $m = rps_match_tick($m, T0 + RPS_REVEAL_SECONDS + 1);
    assert_same([0, 0], $m['score']);
    assert_same(-1, $m['history'][0]['w']);
    assert_true($m['history'][0]['f']);
    assert_same([null, null], $m['history'][0]['m']);
    assert_same(rps_round_new(), $m['cur']);
}

function test_match_view_hides_moves_and_nonces(): void
{
    [$m, [$na]] = t_match_locked('spock', 'lizard');
    $m = rps_match_reveal($m, 0, 'spock', $na, 'lizard');
    $v = rps_match_view('m1', $m);
    $json = json_encode($v);
    assert_true(!str_contains($json, 'spock'), 'Zug im View!');
    assert_true(!str_contains($json, $na), 'Nonce im View!');
    assert_same([true, false], $v['cur']['revealed']);
    assert_same([true, true], $v['cur']['committed']);
    assert_same(T0 + RPS_REVEAL_SECONDS, $v['cur']['deadline']);
    assert_same(['committed', 'revealed', 'commit', 'lockedAt', 'deadline', 'commitDeadline'], array_keys($v['cur']));
    assert_same(null, $v['cur']['commitDeadline'], 'gesperrt → keine Wahl-Frist');
}

function test_match_history_compacts_oldest_draws(): void
{
    $m = rps_match_new('p_a', 'p_b', 3);
    $play = static function (array $m, string $a, string $b): array {
        [$ha, $na] = t_commit($a);
        [$hb, $nb] = t_commit($b);
        $m = rps_match_commit(rps_match_commit($m, 0, $ha, T0), 1, $hb, T0);
        return rps_match_reveal(rps_match_reveal($m, 0, $a, $na, 'classic'), 1, $b, $nb, 'classic');
    };
    $m = $play($m, 'rock', 'scissors');           // entscheidende Runde ganz vorne
    for ($i = 0; $i < RPS_HISTORY_MAX + 10; $i++) {
        $m = $play($m, 'paper', 'paper');
    }
    assert_same(RPS_HISTORY_MAX, count($m['history']));
    assert_same(11, $m['dropped']);
    assert_same(0, $m['history'][0]['w'], 'entscheidende Runde bleibt erhalten');
    assert_same([1, 0], $m['score']);
    assert_same(11, rps_match_view('m1', $m)['dropped']);
}

function test_match_history_compaction_keeps_decisive_rounds(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    $m['history'] = array_fill(0, RPS_HISTORY_MAX + 1, ['m' => ['rock', 'paper'], 'n' => [null, null], 'h' => [null, null], 'w' => 1, 'f' => false]);
    $c = rps_match_compact_history($m);
    assert_same(RPS_HISTORY_MAX + 1, count($c['history']), 'ohne Unentschieden wird nichts entfernt');
    assert_same(0, $c['dropped']);
}

function test_match_commit_deadline_set_by_first_commit(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    assert_same(null, rps_match_view('m1', $m)['cur']['commitDeadline']);
    [$h] = t_commit('rock');
    $m = rps_match_commit($m, 1, $h, T0 + 5);
    assert_same(T0 + 5, $m['cur']['firstCommitAt']);
    assert_same(T0 + 5 + RPS_COMMIT_SECONDS, rps_match_view('m1', $m)['cur']['commitDeadline']);
    assert_same(null, rps_match_view('m1', $m)['cur']['deadline']);
}

function test_match_commit_deadline_forfeits_non_chooser(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h] = t_commit('rock');
    $m = rps_match_commit($m, 1, $h, T0);
    assert_same($m, rps_match_tick($m, T0 + RPS_COMMIT_SECONDS), 'Frist noch nicht abgelaufen');
    $m = rps_match_tick($m, T0 + RPS_COMMIT_SECONDS + 1);
    assert_same([0, 1], $m['score']);
    assert_same(
        ['m' => [null, null], 'n' => [null, null], 'h' => [null, $h], 'w' => 1, 'f' => true],
        $m['history'][0]
    );
    assert_same(rps_round_new(), $m['cur']);
    assert_same(null, rps_match_view('m1', $m)['cur']['commitDeadline']);
}

function test_match_commit_deadline_can_end_match(): void
{
    $m = rps_match_new('p_a', 'p_b', 1);
    [$h] = t_commit('paper');
    $m = rps_match_tick(rps_match_commit($m, 0, $h, T0), T0 + RPS_COMMIT_SECONDS + 1);
    assert_same(0, $m['winner']);
    assert_same('forfeit', $m['end']);
}

function test_match_commit_deadline_ignored_for_legacy_round_without_field(): void
{
    $m = rps_match_new('p_a', 'p_b', 2);
    [$h] = t_commit('paper');
    $m = rps_match_commit($m, 0, $h, T0);
    unset($m['cur']['firstCommitAt']);
    assert_same($m, rps_match_tick($m, T0 + 10 * RPS_COMMIT_SECONDS));
}
