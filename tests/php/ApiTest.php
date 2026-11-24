<?php
// Aktionen über rps_handle() mit echter SQLite-DB (ohne HTTP).
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/** Duell anlegen und beitreten. @return array{0:PDO,1:string,2:array,3:array} [pdo, code, A, B] */
function t_api_duel(int $now = T0): array
{
    $pdo = t_pdo();
    $a = t_api($pdo, ['action' => 'create', 'type' => 'duel', 'name' => 'Anna', 'variant' => 'classic', 'bestOf' => 3], $now);
    $b = t_api($pdo, ['action' => 'join', 'code' => $a['code'], 'name' => 'Ben'], $now);
    return [$pdo, $a['code'], $a, $b];
}

function t_api_state(PDO $pdo, string $code, array $who, int $now = T0, ?int $since = null): array
{
    $in = ['action' => 'state', 'code' => $code, 'token' => $who['token']];
    if ($since !== null) {
        $in['since'] = $since;
    }
    return t_api($pdo, $in, $now);
}

function t_api_play(PDO $pdo, string $code, array $who, string $move, string $action, array &$secret, int $now = T0): array
{
    if ($action === 'commit') {
        $secret = t_commit($move);
        return t_api($pdo, ['action' => 'commit', 'code' => $code, 'token' => $who['token'], 'hash' => $secret[0]], $now);
    }
    return t_api($pdo, ['action' => 'reveal', 'code' => $code, 'token' => $who['token'], 'move' => $move, 'nonce' => $secret[1]], $now);
}

function test_api_create_returns_code_token_me(): void
{
    $pdo = t_pdo();
    $r = t_api($pdo, ['action' => 'create', 'type' => 'tournament', 'name' => ' Anna ', 'variant' => 'lizard', 'bestOf' => 5]);
    assert_same(['code', 'token', 'me'], array_keys($r));
    assert_same($r['code'], rps_valid_code($r['code']));
    assert_same(64, strlen($r['token']));
    $s = t_api_state($pdo, $r['code'], $r);
    assert_same('tournament', $s['type']);
    assert_same('lizard', $s['variant']);
    assert_same(5, $s['bestOf']);
    assert_same('Anna', $s['players'][0]['name']);
    assert_same($r['me'], $s['host']);
    assert_same(1, $s['version']);
}

function test_api_create_validation_errors(): void
{
    $pdo = t_pdo();
    $base = ['action' => 'create', 'type' => 'duel', 'name' => 'Anna'];
    assert_rps_error(static fn() => t_api($pdo, ['type' => 'x'] + $base), 400, 'Spielmodus');
    assert_rps_error(static fn() => t_api($pdo, ['name' => ''] + $base), 400, 'Namen');
    assert_rps_error(static fn() => t_api($pdo, ['variant' => 'x'] + $base), 400, 'Spielvariante');
    assert_rps_error(static fn() => t_api($pdo, ['bestOf' => 7] + $base), 400, 'Best of');
}

function test_api_unknown_action(): void
{
    $pdo = t_pdo();
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'hack']), 400, 'Unbekannte Aktion');
    assert_rps_error(static fn() => t_api($pdo, []), 400, 'Unbekannte Aktion');
}

function test_api_room_not_found_and_bad_token(): void
{
    [$pdo, $code, $a] = t_api_duel();
    [$foreign] = rps_new_token();
    $missing = $code === 'zzzzzz' ? 'yyyyyy' : 'zzzzzz';
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'join', 'code' => $missing, 'name' => 'X']), 404, 'gibt es nicht');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'state', 'code' => $missing, 'token' => $a['token']]), 404);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'state', 'code' => $code, 'token' => $foreign]), 403, 'nicht in diesem Raum');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'state', 'code' => $code, 'token' => 'abc']), 403);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'commit', 'code' => $code, 'token' => $foreign, 'hash' => t_commit('rock')[0]]), 403);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'state', 'code' => 'nope', 'token' => $a['token']]), 400, 'Raumcode');
}

function test_api_join_response_and_full_duel(): void
{
    [$pdo, $code, , $b] = t_api_duel();
    assert_same(['token', 'me', 'spectator'], array_keys($b));
    assert_same(false, $b['spectator']);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'join', 'code' => strtoupper($code), 'name' => 'Carl']), 409, 'voll');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'join', 'code' => $code, 'name' => "\u{200B}"]), 400);
}

function test_api_full_duel_flow_with_versions(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $s = t_api_state($pdo, $code, $a);
    assert_same('running', $s['status']);
    assert_same('m1', $s['myMatch']);
    $v = $s['version'];
    $sa = $sb = [];
    foreach ([['rock', 'rock'], ['rock', 'scissors'], ['paper', 'rock']] as [$ma, $mb]) {
        $r = t_api_play($pdo, $code, $a, $ma, 'commit', $sa);
        assert_same(['ok' => true, 'version' => ++$v], $r);
        t_api_play($pdo, $code, $b, $mb, 'commit', $sb);
        t_api_play($pdo, $code, $b, $mb, 'reveal', $sb);
        $r = t_api_play($pdo, $code, $a, $ma, 'reveal', $sa);
        $v += 3;
        assert_same($v, $r['version']);
    }
    $s = t_api_state($pdo, $code, $b);
    $m = $s['matches']->m1;
    assert_same([2, 0], $m['score']);
    assert_same('score', $m['end']);
    assert_same(3, count($m['history']));
    assert_same(null, $s['myMatch']);
    assert_same([$a['me'] => 1, $b['me'] => 0], (array) $s['series']);

    // Revanche
    $r = t_api($pdo, ['action' => 'rematch', 'code' => $code, 'token' => $b['token']]);
    assert_true($r['ok']);
    t_api($pdo, ['action' => 'rematch', 'code' => $code, 'token' => $a['token']]);
    $s = t_api_state($pdo, $code, $a);
    assert_same('m2', $s['current']);
    assert_same('m2', $s['myMatch']);
    assert_same(1, $s['series']->{$a['me']});
}

function test_api_state_unchanged_and_seen_does_not_bump_version(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $s = t_api_state($pdo, $code, $a);
    $v = $s['version'];
    $u = t_api_state($pdo, $code, $a, T0 + 1, $v);
    assert_same(['version' => $v, 'unchanged' => true, 'now' => T0 + 1], array_slice($u, 0, 3));
    assert_same([$a['me'] => true, $b['me'] => true], (array) $u['online']);
    // seen-Update (älter als 5 s) wird geschrieben, ändert aber nicht die Version.
    $later = T0 + RPS_ONLINE_SECONDS + 2;
    $u = t_api_state($pdo, $code, $a, $later, $v);
    assert_true($u['unchanged']);
    assert_same([$a['me'] => true, $b['me'] => false], (array) $u['online']);
    $row = rps_db_load_room($pdo, $code);
    assert_same($later, $row['room']['players'][$a['me']]['seen']);
    assert_same($v, $row['version']);
    // Abweichendes since → volle Sicht.
    assert_same('duel', t_api_state($pdo, $code, $a, $later, $v - 1)['type']);
    // Nicht-Integer since wird ignoriert.
    assert_same('duel', t_api($pdo, ['action' => 'state', 'code' => $code, 'token' => $a['token'], 'since' => (string) $v], $later)['type']);
}

function test_api_state_without_changes_does_not_write(): void
{
    [$pdo, $code, $a] = t_api_duel();
    $before = rps_db_load_room($pdo, $code);
    t_api_state($pdo, $code, $a, T0 + RPS_SEEN_WRITE_SECONDS);
    assert_same($before, rps_db_load_room($pdo, $code));
}

function test_api_state_applies_deadline_lazily(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $sa = $sb = [];
    t_api_play($pdo, $code, $a, 'rock', 'commit', $sa);
    t_api_play($pdo, $code, $b, 'paper', 'commit', $sb);
    t_api_play($pdo, $code, $a, 'rock', 'reveal', $sa);
    $s = t_api_state($pdo, $code, $a, T0 + 1);
    assert_same(T0 + RPS_REVEAL_SECONDS, $s['matches']->m1['cur']['deadline']);
    assert_true(!str_contains(json_encode($s), '"rock"'), 'Fairness über API');
    $v = $s['version'];
    $s = t_api_state($pdo, $code, $b, T0 + RPS_REVEAL_SECONDS + 1, $v);
    assert_same($v + 1, $s['version']);
    $h = $s['matches']->m1['history'][0];
    assert_same(['rock', null], $h['m']);
    assert_true($h['f']);
    assert_same([1, 0], $s['matches']->m1['score']);
    // Verspätetes Reveal geht nicht mehr.
    assert_rps_error(static fn() => t_api_play($pdo, $code, $b, 'paper', 'reveal', $sb, T0 + 30), 409, 'nichts aufzudecken');
}

function test_api_commit_reveal_errors(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $tok = $a['token'];
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'commit', 'code' => $code, 'token' => $tok, 'hash' => 'xyz']), 400, 'Hash');
    $sa = $sb = [];
    t_api_play($pdo, $code, $a, 'rock', 'commit', $sa);
    assert_rps_error(static fn() => t_api_play($pdo, $code, $a, 'rock', 'commit', $sa), 409, 'schon gewählt');
    t_api_play($pdo, $code, $b, 'paper', 'commit', $sb);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'reveal', 'code' => $code, 'token' => $tok, 'move' => 'rock', 'nonce' => 'x']), 400, 'Nonce');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'reveal', 'code' => $code, 'token' => $tok, 'nonce' => $sa[1]]), 400, 'Zug fehlt');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'reveal', 'code' => $code, 'token' => $tok, 'move' => 'paper', 'nonce' => $sa[1]]), 400, 'passt nicht');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'reveal', 'code' => $code, 'token' => $tok, 'move' => 'lizard', 'nonce' => $sa[1]]), 400, 'Variante');
}

function test_api_react_claim_leave_start(): void
{
    [$pdo, $code, $a, $b] = t_api_duel();
    $r = t_api($pdo, ['action' => 'react', 'code' => $code, 'token' => $a['token'], 'emoji' => '😈']);
    assert_true($r['ok']);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'react', 'code' => $code, 'token' => $a['token'], 'emoji' => '😈']), 429);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'react', 'code' => $code, 'token' => $a['token'], 'emoji' => 'x'], T0 + 5), 400);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'start', 'code' => $code, 'token' => $a['token']]), 400, 'nur im Turnier');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'claim', 'code' => $code, 'token' => $a['token']], T0 + 10), 409, '45 s');
    $late = T0 + RPS_CLAIM_SECONDS + 1;
    assert_true(t_api($pdo, ['action' => 'claim', 'code' => $code, 'token' => $a['token']], $late)['ok']);
    $s = t_api_state($pdo, $code, $b, $late);
    assert_same('claim', $s['matches']->m1['end']);
    assert_same(1, $s['series']->{$a['me']});
    assert_true(t_api($pdo, ['action' => 'leave', 'code' => $code, 'token' => $b['token']], $late)['ok']);
    $s = t_api_state($pdo, $code, $a, $late);
    assert_same('finished', $s['status']);
    assert_true($s['players'][1]['left']);
    // Gegangene dürfen noch lesen, aber nichts mehr tun.
    assert_same('finished', t_api_state($pdo, $code, $b, $late)['status']);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'react', 'code' => $code, 'token' => $b['token'], 'emoji' => '👍'], $late + 5), 409, 'verlassen');
}

function test_api_tournament_flow(): void
{
    $pdo = t_pdo();
    $host = t_api($pdo, ['action' => 'create', 'type' => 'tournament', 'name' => 'Host']);
    $code = $host['code'];
    $players = [$host];
    for ($i = 1; $i < 5; $i++) {
        $players[] = t_api($pdo, ['action' => 'join', 'code' => $code, 'name' => 'Host']);
    }
    $names = array_column(t_api_state($pdo, $code, $host)['players'], 'name');
    assert_same(['Host', 'Host 2', 'Host 3', 'Host 4', 'Host 5'], $names);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'start', 'code' => $code, 'token' => $players[1]['token']]), 403);
    assert_true(t_api($pdo, ['action' => 'start', 'code' => $code, 'token' => $host['token']])['ok']);
    $late = t_api($pdo, ['action' => 'join', 'code' => $code, 'name' => 'Zuschauer']);
    assert_true($late['spectator']);
    assert_true(t_api($pdo, ['action' => 'react', 'code' => $code, 'token' => $late['token'], 'emoji' => '👏'])['ok']);

    $byToken = [];
    foreach ($players as $p) {
        $byToken[$p['me']] = $p;
    }
    $guard = 0;
    do {
        assert_true(++$guard < 50, 'Turnier endet nicht');
        $s = t_api_state($pdo, $code, $host);
        foreach ($players as $p) {
            $mine = t_api_state($pdo, $code, $p)['myMatch'];
            if ($mine === null) {
                continue;
            }
            $m = t_api_state($pdo, $code, $p)['matches']->{$mine};
            $winner = $byToken[$m['p'][0]];
            $loser = $byToken[$m['p'][1]];
            $sw = $sl = [];
            t_api_play($pdo, $code, $winner, 'paper', 'commit', $sw);
            t_api_play($pdo, $code, $loser, 'rock', 'commit', $sl);
            t_api_play($pdo, $code, $winner, 'paper', 'reveal', $sw);
            t_api_play($pdo, $code, $loser, 'rock', 'reveal', $sl);
        }
        $s = t_api_state($pdo, $code, $late);
    } while ($s['status'] === 'running');
    assert_same('finished', $s['status']);
    assert_true(isset($byToken[$s['champion']]));
    assert_same(3, $s['round']);
    // Neues Turnier: Zuschauer wird Teilnehmer.
    t_api($pdo, ['action' => 'start', 'code' => $code, 'token' => $host['token']]);
    $s = t_api_state($pdo, $code, $late);
    assert_same('running', $s['status']);
    assert_same(false, $s['players'][5]['spectator']);
    assert_same(7, count((array) $s['matches']));
}

function test_api_cleanup_and_room_limit(): void
{
    $pdo = t_pdo();
    $old = t_api($pdo, ['action' => 'create', 'type' => 'duel', 'name' => 'Alt'], T0);
    $other = t_api($pdo, ['action' => 'create', 'type' => 'duel', 'name' => 'Neu'], T0 + RPS_ROOM_TTL);
    // Kein Aufräumen ohne Zufallstreffer bei Nicht-create-Requests …
    t_api_state($pdo, $other['code'], $other, T0 + RPS_ROOM_TTL);
    assert_same(2, rps_db_count_rooms($pdo));
    // … aber mit (5 %-Treffer simuliert).
    t_api($pdo, ['action' => 'state', 'code' => $other['code'], 'token' => $other['token']], T0 + RPS_ROOM_TTL + 1, true);
    assert_same(1, rps_db_count_rooms($pdo));
    assert_same(null, rps_db_load_room($pdo, $old['code']));
    // create räumt immer auf; VACUUM bei Zufallstreffer funktioniert.
    t_api($pdo, ['action' => 'create', 'type' => 'duel', 'name' => 'X'], T0 + 3 * RPS_ROOM_TTL, true);
    assert_same(1, rps_db_count_rooms($pdo));
}

function test_api_room_limit(): void
{
    $pdo = t_pdo();
    $pdo->exec('BEGIN');
    $st = $pdo->prepare('INSERT INTO rooms (code, data, version, created, updated) VALUES (?, ?, 1, ?, ?)');
    for ($i = 0; $i < RPS_MAX_ROOMS; $i++) {
        $st->execute(['r' . $i, '{}', T0, T0]);
    }
    $pdo->exec('COMMIT');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'create', 'type' => 'duel', 'name' => 'Zu viel'], T0), 503, 'viele Räume');
}

function test_api_insert_room_rejects_duplicate_code(): void
{
    $pdo = t_pdo();
    $room = rps_room_new('duel', 'classic', 3);
    assert_true(rps_db_insert_room($pdo, 'abcdef', $room, T0));
    assert_true(!rps_db_insert_room($pdo, 'abcdef', $room, T0));
}

function test_api_transaction_rolls_back_on_error(): void
{
    [$pdo, $code, $a] = t_api_duel();
    $before = rps_db_load_room($pdo, $code);
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'rematch', 'code' => $code, 'token' => $a['token']], T0 + 100), 409);
    assert_same($before, rps_db_load_room($pdo, $code), 'seen-Update darf bei Fehler nicht gespeichert sein');
    $pdo->exec('BEGIN IMMEDIATE');
    $pdo->exec('ROLLBACK'); // keine offene Transaktion übrig
}

function test_api_db_uses_wal_or_delete(): void
{
    $pdo = t_pdo();
    $mode = strtolower((string) $pdo->query('PRAGMA journal_mode')->fetchColumn());
    assert_true(in_array($mode, ['wal', 'delete'], true), $mode);
    assert_same(RPS_DB_BUSY_MS, (int) $pdo->query('PRAGMA busy_timeout')->fetchColumn());
}

function test_api_info_is_read_only_and_needs_no_token(): void
{
    [$pdo, $code] = t_api_duel();
    $before = rps_db_load_room($pdo, $code);
    $info = t_api($pdo, ['action' => 'info', 'code' => strtoupper($code)], T0 + 100);
    assert_same($code, $info['code']);
    assert_same('Anna', $info['hostName']);
    assert_same(false, $info['joinable']);
    assert_same($before, rps_db_load_room($pdo, $code), 'info darf nichts schreiben');
    $missing = $code === 'zzzzzz' ? 'yyyyyy' : 'zzzzzz';
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'info', 'code' => $missing]), 404, 'gibt es nicht');
    assert_rps_error(static fn() => t_api($pdo, ['action' => 'info']), 400, 'Raumcode');
}
