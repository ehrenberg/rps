<?php
declare(strict_types=1);

require_once __DIR__ . '/../../public/src/rules.php';

function test_rules_each_move_beats_two_in_lizard(): void
{
    foreach (RPS_VARIANTS['lizard'] as $m) {
        $wins = array_filter(RPS_VARIANTS['lizard'], static fn($o) => rps_beats($m, $o));
        assert_same(2, count($wins), $m);
    }
}

function test_rules_outcome(): void
{
    assert_same(1, rps_outcome('rock', 'scissors'));
    assert_same(-1, rps_outcome('rock', 'paper'));
    assert_same(0, rps_outcome('spock', 'spock'));
    assert_same(1, rps_outcome('spock', 'rock'));
    assert_same(2, rps_target_wins(3));
    assert_same(3, rps_target_wins(5));
    assert_true(!rps_is_valid_move('classic', 'lizard'));
}

/** Prüft, dass rules.js und rules.php dieselbe Tabelle haben. */
function test_rules_match_js(): void
{
    $js = file_get_contents(__DIR__ . '/../../public/assets/js/rules.js');
    foreach (RPS_VERBS as $w => $losers) {
        foreach ($losers as $l => $verb) {
            assert_true(
                (bool) preg_match('/' . $w . ':\s*\{[^}]*\b' . $l . ":\s*'" . $verb . "'/u", $js),
                "rules.js fehlt $w → $l ($verb)"
            );
        }
    }
}
