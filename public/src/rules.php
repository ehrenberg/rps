<?php
// Spielregeln – Spiegel von public/assets/js/rules.js. Immer beide gleichzeitig ändern!
declare(strict_types=1);

const RPS_VARIANTS = [
    'classic' => ['rock', 'paper', 'scissors'],
    'lizard'  => ['rock', 'paper', 'scissors', 'lizard', 'spock'],
];

const RPS_BEST_OF = [3, 5];

/** Gewinner => [Verlierer => Verb] */
const RPS_VERBS = [
    'scissors' => ['paper' => 'schneidet', 'lizard' => 'köpft'],
    'paper'    => ['rock' => 'bedeckt', 'spock' => 'widerlegt'],
    'rock'     => ['lizard' => 'zerquetscht', 'scissors' => 'schleift'],
    'lizard'   => ['spock' => 'vergiftet', 'paper' => 'frisst'],
    'spock'    => ['scissors' => 'zertrümmert', 'rock' => 'verdampft'],
];

function rps_is_valid_variant(string $variant): bool
{
    return isset(RPS_VARIANTS[$variant]);
}

/** @return list<string> */
function rps_moves_for(string $variant): array
{
    if (!rps_is_valid_variant($variant)) {
        throw new InvalidArgumentException("Unbekannte Variante: $variant");
    }
    return RPS_VARIANTS[$variant];
}

function rps_is_valid_move(string $variant, string $move): bool
{
    return rps_is_valid_variant($variant) && in_array($move, RPS_VARIANTS[$variant], true);
}

function rps_beats(string $a, string $b): bool
{
    return isset(RPS_VERBS[$a][$b]);
}

/** 1 = a gewinnt, -1 = b gewinnt, 0 = unentschieden. */
function rps_outcome(string $a, string $b): int
{
    if ($a === $b) {
        return 0;
    }
    if (rps_beats($a, $b)) {
        return 1;
    }
    if (rps_beats($b, $a)) {
        return -1;
    }
    throw new InvalidArgumentException("Ungültige Paarung: $a / $b");
}

function rps_target_wins(int $bestOf): int
{
    return intdiv($bestOf, 2) + 1;
}
