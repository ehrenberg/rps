<?php
// Gemeinsame Helfer für Server-Tests. Tokens/Nonces werden zur Laufzeit erzeugt (keine Secrets im Repo).
declare(strict_types=1);

require_once __DIR__ . '/../../public/src/handler.php';

const T0 = 1764000000;

/** Commit für einen Zug: [hash, nonce]. */
function t_commit(string $move): array
{
    $nonce = bin2hex(random_bytes(16));
    return [hash('sha256', $move . ':' . $nonce), $nonce];
}

/** Raum mit n Spielern (rein, ohne DB). @return array{0:array,1:list<string>,2:list<string>} [room, ids, tokens] */
function t_room(string $type, int $players, int $bestOf = 3, string $variant = 'classic'): array
{
    $room = rps_room_new($type, $variant, $bestOf);
    $ids = [];
    $tokens = [];
    for ($i = 0; $i < $players; $i++) {
        [$token, $hash] = rps_new_token();
        if ($i === 0) {
            [$room, $id] = rps_room_add_player($room, 'Spieler' . $i, $hash, T0, false);
        } else {
            [$room, $id] = rps_room_join($room, 'Spieler' . $i, $hash, T0);
        }
        $ids[] = $id;
        $tokens[] = $token;
    }
    return [$room, $ids, $tokens];
}

/** Beide Spieler wählen und decken auf. */
function t_round(array $room, string $a, string $b, string $moveA, string $moveB, int $now = T0): array
{
    [$ha, $na] = t_commit($moveA);
    [$hb, $nb] = t_commit($moveB);
    $room = rps_room_commit($room, $a, $ha, $now);
    $room = rps_room_commit($room, $b, $hb, $now);
    $room = rps_room_reveal($room, $a, $moveA, $na);
    return rps_room_reveal($room, $b, $moveB, $nb);
}

/** Spielt das Match von $winner gegen den Gegner bis zum Ende (Stein gegen Schere). */
function t_win_match(array $room, string $mid, string $winner, int $now = T0): array
{
    $m = $room['matches'][$mid];
    $loser = $m['p'][0] === $winner ? $m['p'][1] : $m['p'][0];
    while (!rps_match_over($room['matches'][$mid])) {
        $room = t_round($room, $winner, $loser, 'rock', 'scissors', $now);
    }
    return $room;
}

/** Turnier mit n Spielern starten und bis zum Champion durchspielen (jeweils Spieler p[0] gewinnt). */
function t_play_tournament(array $room, string $host): array
{
    return t_finish_tournament(rps_tournament_start($room, $host));
}

/** Laufendes Turnier zu Ende spielen (jeweils Spieler p[0] gewinnt). */
function t_finish_tournament(array $room): array
{
    $guard = 0;
    while ($room['status'] === 'running') {
        assert_true(++$guard < 100, 'Turnier endet nicht');
        $playable = array_filter($room['matches'], 'rps_match_playable');
        assert_true($playable !== [], 'Turnier hängt: kein spielbares Match');
        foreach ($playable as $mid => $m) {
            $room = t_win_match($room, (string) $mid, $m['p'][0]);
        }
    }
    return $room;
}

/** Erwartet RpsError mit Status (und optional Textteil). */
function assert_rps_error(callable $fn, int $status, string $contains = ''): void
{
    $e = assert_throws($fn, RpsError::class);
    assert_same($status, $e->status(), 'HTTP-Status für „' . $e->getMessage() . '“:');
    if ($contains !== '') {
        assert_true(str_contains($e->getMessage(), $contains), 'Fehlertext „' . $e->getMessage() . "“ enthält nicht „{$contains}“");
    }
}

/** Frische SQLite-DB in einem Temp-Verzeichnis. */
function t_pdo(): PDO
{
    $dir = sys_get_temp_dir() . '/rps-test-' . bin2hex(random_bytes(6));
    mkdir($dir);
    register_shutdown_function(static function () use ($dir): void {
        foreach (glob($dir . '/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($dir);
    });
    return rps_db_open($dir);
}

/** API-Aufruf ohne HTTP; Zufall (Aufräumen/VACUUM) standardmäßig aus. */
function t_api(PDO $pdo, array $in, int $now = T0, bool $chance = false): array
{
    return rps_handle($pdo, $in, $now, static fn(int $p): bool => $chance);
}
