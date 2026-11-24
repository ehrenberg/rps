<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function test_validate_name_trims_and_collapses_whitespace(): void
{
    assert_same('Anna Lena', rps_clean_name("  Anna \t\n Lena\u{00A0} "));
}

function test_validate_name_strips_control_and_zero_width(): void
{
    assert_same('Anna', rps_clean_name("An\u{200B}n\u{0007}a\u{FEFF}\u{202E}"));
}

function test_validate_name_keeps_unicode(): void
{
    assert_same('Jürgen 🔥', rps_clean_name('Jürgen 🔥'));
    assert_same(20, mb_strlen(rps_clean_name(str_repeat('ä', 20))));
}

function test_validate_name_rejects_invalid(): void
{
    assert_rps_error(static fn() => rps_clean_name(null), 400, 'Namen');
    assert_rps_error(static fn() => rps_clean_name(42), 400);
    assert_rps_error(static fn() => rps_clean_name(''), 400);
    assert_rps_error(static fn() => rps_clean_name(" \u{200B} "), 400, 'Namen');
    assert_rps_error(static fn() => rps_clean_name(str_repeat('a', 21)), 400, '20 Zeichen');
    assert_rps_error(static fn() => rps_clean_name("\xC3\x28"), 400, 'Ungültiger Name');
    assert_rps_error(static fn() => rps_clean_name(str_repeat('a', 401)), 400, 'Ungültiger Name');
}

function test_validate_unique_name_adds_suffix(): void
{
    assert_same('Anna', rps_unique_name('Anna', ['Bob']));
    assert_same('anna 2', rps_unique_name('anna', ['Anna']));
    assert_same('Anna 3', rps_unique_name('Anna', ['Anna', 'Anna 2']));
    $long = str_repeat('x', 20);
    $u = rps_unique_name($long, [$long]);
    assert_same(str_repeat('x', 18) . ' 2', $u);
    assert_same(20, mb_strlen($u));
}

function test_validate_code(): void
{
    assert_same('k7f3qa', rps_valid_code(' K7F3QA '));
    assert_rps_error(static fn() => rps_valid_code(null), 400, 'Raumcode');
    assert_rps_error(static fn() => rps_valid_code('k7f3q'), 400, 'Ungültiger Raumcode');
    assert_rps_error(static fn() => rps_valid_code('k7f3q1'), 400); // 1 nicht im Alphabet
    assert_rps_error(static fn() => rps_valid_code('k7f3ql'), 400); // l nicht im Alphabet
}

function test_validate_new_code_uses_alphabet(): void
{
    for ($i = 0; $i < 50; $i++) {
        $c = rps_new_code();
        assert_same($c, rps_valid_code($c));
    }
}

function test_validate_token(): void
{
    [$token, $hash] = rps_new_token();
    assert_same(64, strlen($token));
    assert_same(hash('sha256', $token), $hash);
    assert_same($token, rps_valid_token($token));
    assert_rps_error(static fn() => rps_valid_token(strtoupper($token)), 403);
    assert_rps_error(static fn() => rps_valid_token(substr($token, 1)), 403);
    assert_rps_error(static fn() => rps_valid_token(null), 403);
}

function test_validate_hash_and_nonce(): void
{
    [$hash, $nonce] = t_commit('rock');
    assert_same($hash, rps_valid_hash($hash));
    assert_same($nonce, rps_valid_nonce($nonce));
    assert_rps_error(static fn() => rps_valid_hash(strtoupper($hash)), 400, 'Hash');
    assert_rps_error(static fn() => rps_valid_hash($hash . 'a'), 400);
    assert_rps_error(static fn() => rps_valid_hash(123), 400);
    assert_rps_error(static fn() => rps_valid_nonce($hash), 400, 'Nonce');
    assert_rps_error(static fn() => rps_valid_nonce(str_repeat('g', 32)), 400);
}

function test_validate_type_variant_best_of(): void
{
    assert_same('duel', rps_valid_type('duel'));
    assert_same('tournament', rps_valid_type('tournament'));
    assert_rps_error(static fn() => rps_valid_type('league'), 400);
    assert_same('classic', rps_valid_variant_input(null));
    assert_same('lizard', rps_valid_variant_input('lizard'));
    assert_rps_error(static fn() => rps_valid_variant_input('spock'), 400);
    assert_rps_error(static fn() => rps_valid_variant_input(1), 400);
    assert_same(3, rps_valid_best_of(null));
    assert_same(5, rps_valid_best_of(5));
    assert_same(5, rps_valid_best_of('5'));
    assert_rps_error(static fn() => rps_valid_best_of(4), 400, 'Best of');
    assert_rps_error(static fn() => rps_valid_best_of('drei'), 400);
}

function test_validate_emoji(): void
{
    foreach (RPS_EMOJIS as $e) {
        assert_same($e, rps_valid_emoji($e));
    }
    assert_rps_error(static fn() => rps_valid_emoji('💩'), 400, 'Reaktion');
    assert_rps_error(static fn() => rps_valid_emoji('<b>'), 400);
    assert_rps_error(static fn() => rps_valid_emoji(null), 400);
}

function test_validate_move_input(): void
{
    assert_same('rock', rps_valid_move_input('rock'));
    assert_rps_error(static fn() => rps_valid_move_input(''), 400, 'Zug');
    assert_rps_error(static fn() => rps_valid_move_input(['rock']), 400);
}
