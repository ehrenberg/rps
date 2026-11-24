<?php
// Fehlerklasse und Eingabeprüfung. Reine Funktionen, keine Abhängigkeiten außer rules.php.
declare(strict_types=1);

require_once __DIR__ . '/rules.php';

/** Fachlicher Fehler mit HTTP-Status und deutschem, anzeigbarem Text. */
final class RpsError extends RuntimeException
{
    public function __construct(string $message, private int $status = 400)
    {
        parent::__construct($message);
    }

    public function status(): int
    {
        return $this->status;
    }
}

const RPS_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const RPS_CODE_LENGTH = 6;
const RPS_NAME_MAX = 20;
const RPS_EMOJIS = ['👍', '😂', '😱', '🔥', '😭', '🤝', '👏', '😈'];

/** Zufällige Zeichenkette aus dem Raumcode-Alphabet (CSPRNG). */
function rps_random_chars(int $length): string
{
    $max = strlen(RPS_CODE_ALPHABET) - 1;
    $s = '';
    for ($i = 0; $i < $length; $i++) {
        $s .= RPS_CODE_ALPHABET[random_int(0, $max)];
    }
    return $s;
}

function rps_new_code(): string
{
    return rps_random_chars(RPS_CODE_LENGTH);
}

/** @return array{0:string,1:string} [token, sha256(token)] */
function rps_new_token(): array
{
    $token = bin2hex(random_bytes(32));
    return [$token, hash('sha256', $token)];
}

function rps_is_hex(mixed $v, int $length): bool
{
    return is_string($v) && strlen($v) === $length && preg_match('/^[0-9a-f]+$/D', $v) === 1;
}

/** Normalisiert und prüft einen Raumcode. */
function rps_valid_code(mixed $code): string
{
    if (!is_string($code)) {
        throw new RpsError('Raumcode fehlt.', 400);
    }
    $code = strtolower(trim($code));
    if (strlen($code) !== RPS_CODE_LENGTH || strspn($code, RPS_CODE_ALPHABET) !== RPS_CODE_LENGTH) {
        throw new RpsError('Ungültiger Raumcode.', 400);
    }
    return $code;
}

function rps_valid_token(mixed $token): string
{
    if (!rps_is_hex($token, 64)) {
        throw new RpsError('Ungültige Sitzung. Bitte tritt dem Raum neu bei.', 403);
    }
    return $token;
}

/**
 * Bereinigt einen Namen: Steuer-/Formatzeichen (inkl. Zero-Width) raus, Leerraum zusammenfassen,
 * trimmen. Erlaubt 1–20 Zeichen (Codepoints).
 */
function rps_clean_name(mixed $name): string
{
    if (!is_string($name) || $name === '') {
        throw new RpsError('Bitte gib einen Namen ein.', 400);
    }
    if (strlen($name) > 400 || !mb_check_encoding($name, 'UTF-8')) {
        throw new RpsError('Ungültiger Name.', 400);
    }
    // \p{C}: Steuerzeichen, Formatzeichen (Zero-Width, Bidi), private/unbelegte Codepoints.
    $name = preg_replace('/\p{C}+/u', '', $name);
    $name = $name === null ? null : preg_replace('/[\s\p{Z}]+/u', ' ', $name);
    $name = $name === null ? null : preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $name);
    if ($name === null) {
        throw new RpsError('Ungültiger Name.', 400);
    }
    $len = mb_strlen($name, 'UTF-8');
    if ($len === 0) {
        throw new RpsError('Bitte gib einen Namen ein.', 400);
    }
    if ($len > RPS_NAME_MAX) {
        throw new RpsError('Der Name darf höchstens 20 Zeichen lang sein.', 400);
    }
    return $name;
}

/**
 * Hängt bei doppelten Namen (ohne Groß-/Kleinschreibung) „ 2“, „ 3“ … an.
 * @param list<string> $taken
 */
function rps_unique_name(string $name, array $taken): string
{
    $lower = array_map(static fn(string $n): string => mb_strtolower($n, 'UTF-8'), $taken);
    if (!in_array(mb_strtolower($name, 'UTF-8'), $lower, true)) {
        return $name;
    }
    for ($i = 2; ; $i++) {
        $suffix = ' ' . $i;
        $base = mb_substr($name, 0, RPS_NAME_MAX - mb_strlen($suffix, 'UTF-8'), 'UTF-8');
        $candidate = rtrim($base) . $suffix;
        if (!in_array(mb_strtolower($candidate, 'UTF-8'), $lower, true)) {
            return $candidate;
        }
    }
}

function rps_valid_type(mixed $type): string
{
    if ($type !== 'duel' && $type !== 'tournament') {
        throw new RpsError('Unbekannter Spielmodus.', 400);
    }
    return $type;
}

function rps_valid_variant_input(mixed $variant): string
{
    if ($variant === null) {
        return 'classic';
    }
    if (!is_string($variant) || !rps_is_valid_variant($variant)) {
        throw new RpsError('Unbekannte Spielvariante.', 400);
    }
    return $variant;
}

function rps_valid_best_of(mixed $bestOf): int
{
    if ($bestOf === null) {
        return 3;
    }
    if (is_string($bestOf) && ctype_digit($bestOf)) {
        $bestOf = (int) $bestOf;
    }
    if (!is_int($bestOf) || !in_array($bestOf, RPS_BEST_OF, true)) {
        throw new RpsError('„Best of“ muss 3 oder 5 sein.', 400);
    }
    return $bestOf;
}

function rps_valid_hash(mixed $hash): string
{
    if (!rps_is_hex($hash, 64)) {
        throw new RpsError('Ungültiger Zug-Hash.', 400);
    }
    return $hash;
}

function rps_valid_nonce(mixed $nonce): string
{
    if (!rps_is_hex($nonce, 32)) {
        throw new RpsError('Ungültige Nonce.', 400);
    }
    return $nonce;
}

function rps_valid_emoji(mixed $emoji): string
{
    if (!is_string($emoji) || !in_array($emoji, RPS_EMOJIS, true)) {
        throw new RpsError('Diese Reaktion gibt es nicht.', 400);
    }
    return $emoji;
}
