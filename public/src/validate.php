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
const RPS_NAME_MAX = 20;            // Grapheme (sichtbare Zeichen)
const RPS_NAME_MAX_CODEPOINTS = 80; // hartes Limit gegen Combining-Spam
const RPS_WATCH_MAX = 10;           // Räume pro `watch`-Request
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

/** Unsichtbare Füllzeichen, die nicht in \p{C} liegen (Hangul-Filler, Braille-Leerzeichen, CGJ, Khmer). */
const RPS_INVISIBLE_CHARS = '\x{115F}\x{1160}\x{3164}\x{FFA0}\x{2800}\x{034F}\x{17B4}\x{17B5}\x{180E}';
/** Zeichen, zwischen denen ein ZWJ (U+200D) erlaubt ist: Emoji, Hauttöne, Variation Selector 16. */
const RPS_EMOJI_CHARS = '\x{2300}-\x{23FF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{1F000}-\x{1FAFF}\x{FE0F}';

/**
 * Bereinigt einen Namen: NFC (falls intl vorhanden), alle Leerraumarten → ein Leerzeichen,
 * unsichtbare Füll-, Steuer- und Formatzeichen raus (ZWJ nur zwischen Emoji erlaubt), trimmen.
 * Erlaubt 1–20 Grapheme und höchstens 80 Codepoints. Gleiche Regeln wie sanitizeName() in
 * public/assets/js/settings.js; gemeinsame Testfälle in tests/fixtures/names.json.
 */
function rps_clean_name(mixed $name): string
{
    if (!is_string($name) || $name === '') {
        throw new RpsError('Bitte gib einen Namen ein.', 400);
    }
    if (strlen($name) > 400 || !mb_check_encoding($name, 'UTF-8')) {
        throw new RpsError('Ungültiger Name.', 400);
    }
    $name = rps_strip_invisible(rps_normalize_nfc($name));
    if ($name === '') {
        throw new RpsError('Bitte gib einen Namen ein.', 400);
    }
    if (count(rps_graphemes($name)) > RPS_NAME_MAX || mb_strlen($name, 'UTF-8') > RPS_NAME_MAX_CODEPOINTS) {
        throw new RpsError('Der Name darf höchstens 20 Zeichen lang sein.', 400);
    }
    return $name;
}

/** Emoji-Basiszeichen (Extended_Pictographic, grob; ohne Regional Indicators – die kann \X). */
const RPS_EMOJI_BASE = '\x{00A9}\x{00AE}\x{203C}\x{2049}\x{2122}\x{2139}\x{2194}-\x{21AA}\x{2300}-\x{23FF}\x{24C2}'
    . '\x{25AA}-\x{27BF}\x{2934}\x{2935}\x{2B00}-\x{2BFF}\x{3030}\x{303D}\x{3297}\x{3299}\x{1F000}-\x{1F1E5}\x{1F200}-\x{1FAFF}';
/** Was an einem Emoji hängt: Variation Selector, Hautton, Keycap, Tag-Zeichen, Combining. */
const RPS_EMOJI_EXTEND = '\p{M}\x{1F3FB}-\x{1F3FF}\x{E0020}-\x{E007F}';

/**
 * Zerlegt in Grapheme wie Intl.Segmenter im Browser (PCRE \X, braucht kein intl).
 * Emoji-Folgen werden explizit erkannt: ältere PCRE2 (z. B. 10.39 in PHP 8.1) kleben aufeinanderfolgende Emoji
 * fälschlich zu einem \X zusammen („😀😀“ = 1).
 * @return list<string>
 */
function rps_graphemes(string $s): array
{
    $b = RPS_EMOJI_BASE;
    $x = RPS_EMOJI_EXTEND;
    $emoji = "[$b][$x]*(?:\\x{200D}[$b][$x]*)*";
    if (preg_match_all("/$emoji|\\X/u", $s, $m) === false) {
        throw new RpsError('Ungültiger Name.', 400);
    }
    return $m[0];
}

function rps_normalize_nfc(string $s): string
{
    if (!function_exists('normalizer_normalize')) {
        return $s;
    }
    $n = normalizer_normalize($s);
    return is_string($n) ? $n : $s;
}

/** Entfernt Unsichtbares, fasst Leerraum zusammen und trimmt (erwartet gültiges UTF-8). */
function rps_strip_invisible(string $s): string
{
    $e = RPS_EMOJI_CHARS;
    $steps = [
        '/[\s\p{Z}]/u' => ' ',                                      // Tab, NBSP, U+2000–200A … → Leerzeichen
        '/[' . RPS_INVISIBLE_CHARS . ']/u' => '',
        '/[^\P{C}\x{200D}]/u' => '',                                // \p{C} außer ZWJ
        '/(^| )[\x{FE00}-\x{FE0F}]+/u' => '$1',                       // Variation Selector ohne Basiszeichen
        "/(?<![$e])\\x{200D}|\\x{200D}(?![$e])/u" => '',            // ZWJ nur zwischen Emoji
        '/ {2,}/' => ' ',
    ];
    foreach ($steps as $pattern => $replacement) {
        $s = preg_replace($pattern, $replacement, $s);
        if ($s === null) {
            throw new RpsError('Ungültiger Name.', 400);
        }
    }
    return trim($s, ' ');
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
        // Grapheme-sicher kürzen: kein halbes Emoji, Codepoint-Limit bleibt eingehalten
        $parts = array_slice(rps_graphemes($name), 0, RPS_NAME_MAX - strlen($suffix));
        while ($parts !== [] && mb_strlen(implode('', $parts), 'UTF-8') + strlen($suffix) > RPS_NAME_MAX_CODEPOINTS) {
            array_pop($parts);
        }
        $base = implode('', $parts);
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

/**
 * Prüft die Struktur der `watch`-Liste (1–10 Objekte mit String-`code`). Code und Token werden hier
 * NICHT geprüft – ein ungültiger Eintrag soll nur sich selbst betreffen. Doppelte Codes: der letzte
 * Eintrag zählt. Nicht-Integer-`since` wird ignoriert (wie bei `state`).
 * @return array<string,array{code:string,token:mixed,since:?int}> Schlüssel = Code wie gesendet
 */
function rps_valid_watch_list(mixed $rooms): array
{
    if (!is_array($rooms) || !array_is_list($rooms) || $rooms === []) {
        throw new RpsError('Ungültige Anfrage (Raumliste erwartet).', 400);
    }
    if (count($rooms) > RPS_WATCH_MAX) {
        throw new RpsError('Zu viele Räume auf einmal.', 400);
    }
    $entries = [];
    foreach ($rooms as $entry) {
        if (!is_array($entry) || array_is_list($entry) || !is_string($entry['code'] ?? null)) {
            throw new RpsError('Ungültige Anfrage (Raumeintrag mit Code erwartet).', 400);
        }
        $code = $entry['code'];
        unset($entries[$code]);   // letzter zählt – auch in der Reihenfolge
        $entries[$code] = [
            'code' => $code,
            'token' => $entry['token'] ?? null,
            'since' => isset($entry['since']) && is_int($entry['since']) ? $entry['since'] : null,
        ];
    }
    return $entries;
}
