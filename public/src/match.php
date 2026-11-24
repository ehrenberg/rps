<?php
// Ein Match: Commit-Reveal, Runden, Wertung, Fristen. Reine Funktionen auf Arrays, „now“ als Parameter.
declare(strict_types=1);

require_once __DIR__ . '/validate.php';

const RPS_REVEAL_SECONDS = 20;

/**
 * @param list<string>|null $from Turnier: IDs der Vorgänger-Matches (Platzhalter), sonst null
 */
function rps_match_new(?string $a, ?string $b, int $target, ?array $from = null): array
{
    return [
        'p' => [$a, $b],
        'score' => [0, 0],
        'target' => $target,
        'cur' => rps_round_new(),
        'history' => [],
        'winner' => null,
        'end' => null,
        'from' => $from,
    ];
}

function rps_round_new(): array
{
    return ['commit' => [null, null], 'move' => [null, null], 'nonce' => [null, null], 'lockedAt' => null];
}

function rps_match_over(array $m): bool
{
    return $m['end'] !== null;
}

/** Läuft und beide Plätze sind besetzt → es kann gespielt werden. */
function rps_match_playable(array $m): bool
{
    return $m['end'] === null && $m['p'][0] !== null && $m['p'][1] !== null;
}

/** Index des Spielers im Match oder null. */
function rps_match_index(array $m, string $playerId): ?int
{
    if ($m['p'][0] === $playerId) {
        return 0;
    }
    if ($m['p'][1] === $playerId) {
        return 1;
    }
    return null;
}

function rps_match_finish(array $m, ?int $winner, string $end): array
{
    $m['winner'] = $winner;
    $m['end'] = $end;
    $m['cur'] = rps_round_new();
    return $m;
}

function rps_match_commit(array $m, int $idx, string $hash, int $now): array
{
    if (!rps_match_playable($m)) {
        throw new RpsError('Das Match läuft gerade nicht.', 409);
    }
    if ($m['cur']['commit'][$idx] !== null) {
        throw new RpsError('Du hast in dieser Runde schon gewählt.', 409);
    }
    if ($m['cur']['commit'][1 - $idx] !== null && hash_equals($m['cur']['commit'][1 - $idx], $hash)) {
        throw new RpsError('Ungültiger Zug-Hash.', 400);
    }
    $m['cur']['commit'][$idx] = $hash;
    if ($m['cur']['commit'][1 - $idx] !== null) {
        $m['cur']['lockedAt'] = $now;
    }
    return $m;
}

function rps_match_reveal(array $m, int $idx, string $move, string $nonce, string $variant): array
{
    if (!rps_match_playable($m)) {
        throw new RpsError('Das Match läuft gerade nicht.', 409);
    }
    if ($m['cur']['lockedAt'] === null) {
        throw new RpsError('Es gibt gerade nichts aufzudecken.', 409);
    }
    if ($m['cur']['move'][$idx] !== null) {
        throw new RpsError('Du hast schon aufgedeckt.', 409);
    }
    if (!rps_is_valid_move($variant, $move)) {
        throw new RpsError('Diesen Zug gibt es in dieser Variante nicht.', 400);
    }
    if (!hash_equals($m['cur']['commit'][$idx], hash('sha256', $move . ':' . $nonce))) {
        throw new RpsError('Der Zug passt nicht zum gewählten Hash.', 400);
    }
    $m['cur']['move'][$idx] = $move;
    $m['cur']['nonce'][$idx] = $nonce;
    if ($m['cur']['move'][1 - $idx] === null) {
        return $m;
    }
    $cur = $m['cur'];
    $o = rps_outcome($cur['move'][0], $cur['move'][1]);
    $w = $o === 1 ? 0 : ($o === -1 ? 1 : -1);
    return rps_match_close_round($m, $w, false, 'score');
}

/** Rundenergebnis eintragen, neue Runde starten, ggf. Match beenden. */
function rps_match_close_round(array $m, int $w, bool $forfeit, string $endReason): array
{
    $cur = $m['cur'];
    $m['history'][] = [
        'm' => $cur['move'],
        'n' => $cur['nonce'],
        'h' => $cur['commit'],
        'w' => $w,
        'f' => $forfeit,
    ];
    $m['cur'] = rps_round_new();
    if ($w >= 0) {
        $m['score'][$w]++;
        if ($m['score'][$w] >= $m['target']) {
            $m = rps_match_finish($m, $w, $endReason);
        }
    }
    return $m;
}

/**
 * Frist auswerten: 20 s nach lockedAt nicht aufgedeckt → Runde verloren (f: true).
 * Decken beide nicht auf, wird die Runde ohne Punkt neu gestartet (w: -1, f: true).
 */
function rps_match_tick(array $m, int $now): array
{
    $locked = $m['cur']['lockedAt'];
    if ($m['end'] !== null || $locked === null || $now <= $locked + RPS_REVEAL_SECONDS) {
        return $m;
    }
    $r0 = $m['cur']['move'][0] !== null;
    $r1 = $m['cur']['move'][1] !== null;
    if ($r0 === $r1) {
        // Keiner hat aufgedeckt (beide aufgedeckt wäre schon gewertet).
        return rps_match_close_round($m, -1, true, 'forfeit');
    }
    return rps_match_close_round($m, $r0 ? 0 : 1, true, 'forfeit');
}

/** Öffentliche Sicht – enthält für die laufende Runde NIE Züge oder Nonces. */
function rps_match_view(string $id, array $m): array
{
    $c = $m['cur'];
    return [
        'id' => $id,
        'p' => $m['p'],
        'score' => $m['score'],
        'target' => $m['target'],
        'cur' => [
            'committed' => [$c['commit'][0] !== null, $c['commit'][1] !== null],
            'revealed' => [$c['move'][0] !== null, $c['move'][1] !== null],
            'commit' => $c['commit'],
            'lockedAt' => $c['lockedAt'],
            'deadline' => $c['lockedAt'] === null ? null : $c['lockedAt'] + RPS_REVEAL_SECONDS,
        ],
        'history' => $m['history'],
        'winner' => $m['winner'],
        'end' => $m['end'],
        'from' => $m['from'] ?? null,
    ];
}
