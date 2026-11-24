<?php
// Turnier: Lobby, zufällige Setzung, K.-o.-Baum mit Freilosen und Platzhaltern, Champion.
// Reine Funktionen auf Raum-Arrays.
declare(strict_types=1);

require_once __DIR__ . '/room.php';

const RPS_TOURNAMENT_MIN = 3;
const RPS_TOURNAMENT_MAX = 16;

/** @return array{0:array,1:string,2:bool} */
function rps_tournament_join(array $room, string $name, string $tokenHash, int $now): array
{
    if (count($room['order']) >= RPS_ROOM_MAX_PLAYERS) {
        throw new RpsError('Dieser Raum ist voll.', 409);
    }
    $spectator = $room['status'] !== 'lobby' || count(rps_tournament_participants($room)) >= RPS_TOURNAMENT_MAX;
    [$room, $id] = rps_room_add_player($room, $name, $tokenHash, $now, $spectator);
    return [$room, $id, $spectator];
}

/** Aktive Teilnehmer (keine Zuschauer, nicht gegangen). */
function rps_tournament_participants(array $room): array
{
    return array_values(array_filter(
        rps_room_active_ids($room),
        static fn(string $id): bool => !$room['players'][$id]['spectator']
    ));
}

/** In der Lobby wird der Spieler entfernt, sonst als gegangen markiert (verliert alle Matches). */
function rps_tournament_leave(array $room, string $id): array
{
    if ($room['status'] === 'lobby') {
        $room = rps_room_remove_player($room, $id);
        return $room['host'] === $id ? rps_room_pass_host($room) : $room;
    }
    return rps_tournament_settle(rps_room_mark_left($room, $id));
}

/** Host startet (erneut) ein Turnier. */
function rps_tournament_start(array $room, string $id): array
{
    if ($room['type'] !== 'tournament') {
        throw new RpsError('Starten gibt es nur im Turnier.', 400);
    }
    rps_room_require_active($room, $id);
    if ($room['host'] !== $id) {
        throw new RpsError('Nur der Host kann das Turnier starten.', 403);
    }
    if ($room['status'] === 'running') {
        throw new RpsError('Das Turnier läuft schon.', 409);
    }
    if ($room['status'] === 'finished') {
        $room = rps_tournament_reset($room);
    }
    $ids = rps_tournament_participants($room);
    if (count($ids) < RPS_TOURNAMENT_MIN) {
        throw new RpsError(sprintf('Für ein Turnier braucht ihr mindestens %d Spieler.', RPS_TOURNAMENT_MIN), 409);
    }
    $room = rps_tournament_build($room, rps_shuffle($ids));
    $room['status'] = 'running';
    return rps_tournament_settle($room);
}

/** Neues Turnier: Gegangene raus, Zuschauer werden (bis 16) Teilnehmer. */
function rps_tournament_reset(array $room): array
{
    foreach ($room['order'] as $pid) {
        if ($room['players'][$pid]['left']) {
            $room = rps_room_remove_player($room, $pid);
        }
    }
    $ranked = array_merge(
        array_filter($room['order'], static fn(string $p): bool => !$room['players'][$p]['spectator']),
        array_filter($room['order'], static fn(string $p): bool => $room['players'][$p]['spectator'])
    );
    foreach (array_values($ranked) as $i => $pid) {
        $room['players'][$pid]['spectator'] = $i >= RPS_TOURNAMENT_MAX;
    }
    $room['matches'] = [];
    $room['bracket'] = [];
    $room['champion'] = null;
    return $room;
}

/** Fisher-Yates mit CSPRNG. */
function rps_shuffle(array $items): array
{
    $items = array_values($items);
    for ($i = count($items) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$items[$i], $items[$j]] = [$items[$j], $items[$i]];
    }
    return $items;
}

function rps_bracket_size(int $players): int
{
    $size = 1;
    while ($size < $players) {
        $size *= 2;
    }
    return $size;
}

/**
 * Paarungen der ersten Runde: Freilose landen in verschiedenen Matches (nie Freilos gegen Freilos),
 * die Reihenfolge der Matches wird zufällig gemischt.
 * @param list<string> $seeded bereits gemischte Spieler-IDs
 * @return list<array{0:string,1:?string}>
 */
function rps_bracket_pairs(array $seeded): array
{
    $matches = rps_bracket_size(count($seeded)) / 2;
    $byes = $matches * 2 - count($seeded);
    $pairs = [];
    $next = 0;
    for ($i = 0; $i < $matches; $i++) {
        $a = $seeded[$next++];
        $b = $i < $byes ? null : $seeded[$next++];
        $pairs[] = [$a, $b];
    }
    return rps_shuffle($pairs);
}

/** Kompletter Baum: Runde 1 mit Spielern/Freilosen, spätere Runden als Platzhalter mit „from“. */
function rps_tournament_build(array $room, array $seeded): array
{
    $target = rps_target_wins($room['bestOf']);
    $round = [];
    foreach (rps_bracket_pairs($seeded) as [$a, $b]) {
        [$room, $mid] = rps_room_next_match_id($room);
        $room['matches'][$mid] = $b === null
            ? rps_match_finish(rps_match_new($a, null, $target), 0, 'bye')
            : rps_match_new($a, $b, $target);
        $round[] = $mid;
    }
    $room['bracket'] = [$round];
    while (count($round) > 1) {
        $next = [];
        foreach (array_chunk($round, 2) as $feeders) {
            [$room, $mid] = rps_room_next_match_id($room);
            $room['matches'][$mid] = rps_match_new(null, null, $target, $feeders);
            $next[] = $mid;
        }
        $room['bracket'][] = $next;
        $round = $next;
    }
    return $room;
}

/**
 * Teilnehmer eines Platzhalter-Slots: ['pending'] solange das Vorgänger-Match läuft,
 * sonst ['done', id|null] (null = Vorgänger ohne Sieger, z. B. beide gegangen).
 */
function rps_tournament_slot(array $room, string $feeder): array
{
    $f = $room['matches'][$feeder];
    if (!rps_match_over($f)) {
        return ['pending'];
    }
    return ['done', $f['winner'] === null ? null : $f['p'][$f['winner']]];
}

/** Sieger nachrücken lassen, Freilose/Gegangene auflösen, Champion setzen. Idempotent. */
function rps_tournament_settle(array $room): array
{
    if ($room['status'] !== 'running') {
        return $room;
    }
    foreach (array_slice($room['bracket'], 1) as $round) {
        foreach ($round as $mid) {
            $room['matches'][$mid] = rps_tournament_settle_match($room, $mid);
        }
    }
    return rps_tournament_check_champion($room);
}

function rps_tournament_settle_match(array $room, string $mid): array
{
    $m = $room['matches'][$mid];
    if (rps_match_over($m)) {
        return $m;
    }
    $slots = array_map(static fn(string $f): array => rps_tournament_slot($room, $f), $m['from']);
    foreach ($slots as $i => $slot) {
        $m['p'][$i] = $slot[0] === 'done' ? $slot[1] : null;
    }
    if ($slots[0][0] === 'pending' || $slots[1][0] === 'pending') {
        return $m;
    }
    if ($m['p'][0] === null || $m['p'][1] === null) {
        $present = $m['p'][0] !== null ? 0 : ($m['p'][1] !== null ? 1 : null);
        if ($present !== null && $room['players'][$m['p'][$present]]['left']) {
            return rps_match_finish($m, null, 'leave');
        }
        return rps_match_finish($m, $present, 'bye');
    }
    return rps_tournament_resolve_left($room, $m);
}

/** Gegangene Spieler verlieren künftige Matches automatisch (sobald beide Plätze feststehen). */
function rps_tournament_resolve_left(array $room, array $m): array
{
    $left0 = $room['players'][$m['p'][0]]['left'];
    $left1 = $room['players'][$m['p'][1]]['left'];
    if ($left0 && $left1) {
        return rps_match_finish($m, null, 'leave');
    }
    if ($left0 || $left1) {
        return rps_match_finish($m, $left0 ? 1 : 0, 'leave');
    }
    return $m;
}

function rps_tournament_check_champion(array $room): array
{
    $finalRound = end($room['bracket']);
    $final = $room['matches'][$finalRound[0]];
    if (!rps_match_over($final)) {
        return $room;
    }
    $room['champion'] = $final['winner'] === null ? null : $final['p'][$final['winner']];
    $room['status'] = 'finished';
    return $room;
}

/** Aktuelle Runde (1-basiert): erste Runde mit offenem Match; im Lobby-Zustand null. */
function rps_tournament_round(array $room): ?int
{
    if ($room['bracket'] === []) {
        return null;
    }
    foreach ($room['bracket'] as $i => $round) {
        foreach ($round as $mid) {
            if (!rps_match_over($room['matches'][$mid])) {
                return $i + 1;
            }
        }
    }
    return count($room['bracket']);
}
