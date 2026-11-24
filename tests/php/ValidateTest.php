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

function test_validate_name_strips_invisible_fillers(): void
{
    foreach (["\u{3164}", "\u{115F}", "\u{1160}", "\u{FFA0}", "\u{2800}", "\u{180E}", "\u{034F}", "\u{3164}\u{2800} \u{200B}"] as $filler) {
        assert_rps_error(static fn() => rps_clean_name($filler), 400, 'Namen');
    }
    assert_same('Anna', rps_clean_name("\u{3164}An\u{2800}na\u{FFA0}"));
}

function test_validate_name_unicode_spaces_collapse(): void
{
    assert_same('A B C', rps_clean_name("A\u{2003}\u{2009}B\u{3000}\u{205F}C"));
    assert_same('A B', rps_clean_name("A\tB"));
    assert_same('A B', rps_clean_name("A \u{200A} \u{2000} B"));
}

function test_validate_name_keeps_zwj_only_between_emoji(): void
{
    $family = "👨\u{200D}👩\u{200D}👧";
    assert_same($family . ' Familie', rps_clean_name($family . ' Familie'));
    assert_same("❤\u{FE0F}\u{200D}🔥", rps_clean_name("❤\u{FE0F}\u{200D}🔥"));
    assert_same('AB', rps_clean_name("A\u{200D}B"));
    assert_same('A🔥', rps_clean_name("A\u{200D}🔥"));
    assert_rps_error(static fn() => rps_clean_name("\u{200D}"), 400);
}

function test_validate_name_nfc_if_intl_available(): void
{
    $decomposed = "Jo\u{0065}\u{0301}l";
    if (!function_exists('normalizer_normalize')) {
        // intl fehlt: Name bleibt (zerlegt) erhalten – Test übersprungen.
        assert_same($decomposed, rps_clean_name($decomposed));
        return;
    }
    assert_same("Jo\u{00E9}l", rps_clean_name($decomposed));
}

/** @return array<string, mixed> Gemeinsame Namens-Fälle (auch von tests/js/settings.test.js gelesen). */
function t_name_fixtures(): array
{
    return json_decode((string) file_get_contents(__DIR__ . '/../fixtures/names.json'), true, 16, JSON_THROW_ON_ERROR);
}

function test_validate_name_shared_fixtures_valid(): void
{
    $f = t_name_fixtures();
    assert_same(RPS_NAME_MAX, $f['maxGraphemes']);
    assert_same(RPS_NAME_MAX_CODEPOINTS, $f['maxCodepoints']);
    foreach ($f['valid'] as $c) {
        assert_same($c['out'], rps_clean_name($c['in']), $c['note']);
        assert_same($c['out'], rps_clean_name($c['out']), $c['note'] . ' (idempotent)');
    }
}

function test_validate_name_shared_fixtures_too_long(): void
{
    foreach (t_name_fixtures()['tooLong'] as $c) {
        assert_rps_error(static fn() => rps_clean_name($c['in']), 400, '20 Zeichen');
        // Die Kürzung des Clients nimmt der Server unverändert an
        assert_same($c['truncated'], rps_clean_name($c['truncated']), $c['note']);
    }
}

function test_validate_name_shared_fixtures_empty(): void
{
    foreach (t_name_fixtures()['empty'] as $in) {
        assert_rps_error(static fn() => rps_clean_name($in), 400, 'Namen');
    }
}

function test_validate_graphemes_match_browser_segmenter(): void
{
    foreach (t_name_fixtures()['graphemeCounts'] as [$s, $n]) {
        assert_same($n, count(rps_graphemes($s)), $s);
        assert_same($s, implode('', rps_graphemes($s)), $s);
    }
}

function test_validate_name_counts_graphemes_not_codepoints(): void
{
    $flag = "🏳\u{FE0F}\u{200D}🌈";
    assert_same(1, count(rps_graphemes($flag)));
    assert_same(str_repeat($flag, 20), rps_clean_name(str_repeat($flag, 20)));
    assert_rps_error(static fn() => rps_clean_name(str_repeat($flag, 21)), 400, '20 Zeichen');
    assert_rps_error(static fn() => rps_clean_name('a' . str_repeat("\u{0332}", 80)), 400, '20 Zeichen');
}

function test_validate_unique_name_is_grapheme_safe(): void
{
    $flag = "🏳\u{FE0F}\u{200D}🌈";
    $name = str_repeat($flag, 20);
    $u = rps_unique_name($name, [$name]);
    assert_same(str_repeat($flag, 18) . ' 2', $u);
    assert_same($u, rps_clean_name($u));
}
