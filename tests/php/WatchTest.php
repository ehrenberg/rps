<?php
// Action `watch` (Sammelabfrage für „Meine Spiele“) über rps_handle() mit echter SQLite-DB.
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ApiTest.php';   // t_api_duel, t_api_play

function t_watch(PDO $pdo, array $rooms, int $now = T0): array
{
    return t_api($pdo, ['action' => 'watch', 'rooms' => $rooms], $now);
}

function t_entry(string $code, array $who, ?int $since = null): array
{
    $e = ['code' => $code, 'token' => $who['token']];
    if ($since !== null) {
        $e['since'] = $since;
    }
    return $e;
}

function test_watch_mixed_list(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $lobby = t_api($pdo, ['action' => 'create', 'type' => 'tournament', 'name' => 'Tina']);
    [$foreign] = rps_new_token();
    $missing = in_array('zzzzzz', [$code, $lobby['code']], true) ? 'yyyyyy' : 'zzzzzz';
    $r = t_watch($pdo, [
        t_entry($code, $a),
        t_entry($lobby['code'], $lobby),
        ['code' => $missing, 'token' => $a['token']],
        ['code' => $code, 'token' => $foreign],   // Duplikat mit fremdem Token: der letzte Eintrag zählt
    ], T0 + 3);
    assert_same(['now', 'rooms'], array_keys($r));
    assert_same(T0 + 3, $r['now']);
    $rooms = (array) $r['rooms'];
    assert_same([$lobby['code'], $missing, $code], array_keys($rooms), 'Duplikat: letzter zählt (und steht hinten)');
    assert_same(['gone' => true, 'reason' => 'forbidden'], $rooms[$code]);
    assert_same(['gone' => true, 'reason' => 'notFound'], $rooms[$missing]);
    $t = $rooms[$lobby['code']];
    assert_same(['tournament', 'lobby', true, 1, 1], [$t['type'], $t['status'], $t['isHost'], $t['players'], $t['version']]);

    $r = t_watch($pdo, [t_entry($code, $b), t_entry($code . 'x', $b), ['code' => $code, 'token' => 'kurz']], T0 + 3);
    $rooms = (array) $r['rooms'];
    assert_same(['gone' => true, 'reason' => 'forbidden'], $rooms[$code . 'x'], 'ungültiger Code → forbidden');
    assert_same(['gone' => true, 'reason' => 'forbidden'], $rooms[$code], 'ungültiges Token-Format → forbidden');

    $s = (array) t_watch($pdo, [t_entry($code, $b)], T0 + 3)['rooms'];
    $s = $s[$code];
    assert_same(['duel', 'running', $b['me'], false, 2, 'Anna', 'm1', true], [$s['type'], $s['status'], $s['me'], $s['isHost'], $s['players'], $s['opponent'], $s['myMatch'], $s['needsMove']]);
    assert_same(T0, $s['updated']);
}

function test_watch_expired_room_is_not_found(): void
{
    [$pdo, $code, $a] = t_api_duel();
    $r = (array) t_watch($pdo, [t_entry($code, $a)], T0 + RPS_ROOM_TTL + 1)['rooms'];
    assert_same(['gone' => true, 'reason' => 'notFound'], $r[$code]);
}

function test_watch_structure_errors(): void
{
    [$pdo, $code, $a] = t_api_duel();
    $eleven = array_fill(0, RPS_WATCH_MAX + 1, t_entry($code, $a));
    assert_rps_error(static fn() => t_watch($pdo, $eleven), 400, 'Zu viele Räume');
    assert_same(1, count((array) t_watch($pdo, array_fill(0, RPS_WATCH_MAX, t_entry($code, $a)))['rooms']));
    assert_rps_error(static fn() => t_watch($pdo, []), 400, 'Raumliste');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'watch']), 400, 'Raumliste');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'watch', 'rooms' => ['a' => t_entry($code, $a)]]), 400, 'Raumliste');
    assert_rps_error(static fn() => t_watch($pdo, ['k7f3qa']), 400, 'Raumeintrag');
    assert_rps_error(static fn() => t_watch($pdo, [['code' => 123456, 'token' => $a['token']]]), 400, 'Raumeintrag');
    assert_rps_error(static fn() => t_watch($pdo, [['token' => $a['token']]]), 400, 'Raumeintrag');
}

function test_watch_unchanged_and_seen_update(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $before = rps_db_load_room($pdo, $code, T0);
    $v = $before['version'];
    // seen jung genug → kein Schreibzugriff.
    $r = (array) t_watch($pdo, [t_entry($code, $a, $v)], T0 + RPS_SEEN_WRITE_SECONDS)['rooms'];
    assert_same(['version' => $v, 'unchanged' => true], $r[$code]);
    assert_same($before, rps_db_load_room($pdo, $code, T0), 'watch darf ohne Grund nichts schreiben');
    // seen älter als 5 s → geschrieben, version bleibt.
    $later = T0 + RPS_SEEN_WRITE_SECONDS + 1;
    $r = (array) t_watch($pdo, [t_entry($code, $a, $v)], $later)['rooms'];
    assert_same(['version' => $v, 'unchanged' => true], $r[$code]);
    $row = rps_db_load_room($pdo, $code, T0);
    assert_same($later, $row['room']['players'][$a['me']]['seen']);
    assert_same(T0, $row['room']['players'][$b['me']]['seen']);
    assert_same([$v, $later], [$row['version'], $row['updated']]);
    // Nicht-Integer since wird ignoriert → volle Kurzfassung.
    $r = (array) t_watch($pdo, [['code' => $code, 'token' => $a['token'], 'since' => (string) $v]], $later)['rooms'];
    assert_same('duel', $r[$code]['type']);
    assert_same($later, $r[$code]['updated']);
}

function test_watch_applies_deadlines_and_counts_as_presence(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $sa = [];
    t_api_play($pdo, $code, $a, 'rock', 'commit', $sa);
    $v = rps_db_load_room($pdo, $code, T0)['version'];
    $r = (array) t_watch($pdo, [t_entry($code, $b, $v)], T0 + 1)['rooms'];
    assert_true($r[$code]['unchanged']);
    // Wahl-Frist abgelaufen → watch wertet aus, version +1, B muss neu wählen.
    $late = T0 + RPS_COMMIT_SECONDS + 1;
    $s = ((array) t_watch($pdo, [t_entry($code, $b, $v)], $late)['rooms'])[$code];
    assert_same([$v + 1, true], [$s['version'], $s['needsMove']]);
    $state = t_api_state($pdo, $code, $a, $late);
    assert_same([1, 0], $state['matches']->m1['score']);
    // watch zählt als Anwesenheit: B gilt für A als online.
    assert_same(true, $state['players'][1]['online']);
}

function test_watch_left_player(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    t_api($pdo, ['action' => 'leave', 'code' => $code, 'token' => $b['token']]);
    $r = (array) t_watch($pdo, [t_entry($code, $b), t_entry(strtoupper($code), $a)], T0 + 1)['rooms'];
    assert_same(['gone' => true, 'reason' => 'left'], $r[$code]);
    $s = $r[strtoupper($code)];
    assert_same(['finished', 1, 'Ben'], [$s['status'], $s['players'], $s['opponent']], 'Schlüssel = Code wie gesendet');
}

function test_watch_fairness_and_json_shape(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $sa = $sb = [];
    t_api_play($pdo, $code, $a, 'rock', 'commit', $sa);
    t_api_play($pdo, $code, $b, 'paper', 'commit', $sb);
    t_api_play($pdo, $code, $a, 'rock', 'reveal', $sa);
    $json = json_encode(t_watch($pdo, [t_entry($code, $a), t_entry($code, $b), ['code' => '234567', 'token' => $a['token']]], T0 + 1));
    foreach (['rock', 'paper', $sa[0], $sa[1], $sb[0], $sb[1], $a['token'], $b['token'], 'tokenHash', 'history'] as $secret) {
        assert_true(!str_contains($json, $secret), "watch enthält „{$secret}“");
    }
    assert_true(str_contains($json, '"rooms":{"'), 'rooms ist ein Objekt: ' . $json);
    assert_true(str_contains($json, '"234567":{"gone":true,"reason":"notFound"}'), $json);
}

function test_watch_rooms_encode_as_object_for_numeric_codes(): void
{
    $pdo = t_pdo();
    $json = json_encode(t_watch($pdo, [['code' => '0', 'token' => 'x']]));
    assert_same('{"now":' . T0 . ',"rooms":{"0":{"gone":true,"reason":"forbidden"}}}', $json);
}
