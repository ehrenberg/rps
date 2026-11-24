<?php
// Einziger Server-Einstiegspunkt: HTTP-Schicht (Methode, Body, JSON, Statuscodes). Logik: src/handler.php.
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/src/handler.php';

const RPS_MAX_BODY_BYTES = 4096;

/** @return never */
function rps_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function rps_read_body(): array
{
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > RPS_MAX_BODY_BYTES) {
        throw new RpsError('Anfrage ist zu groß.', 413);
    }
    $raw = file_get_contents('php://input', false, null, 0, RPS_MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > RPS_MAX_BODY_BYTES) {
        throw new RpsError('Anfrage ist zu groß.', 413);
    }
    try {
        $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RpsError('Ungültige Anfrage (kein JSON).', 400);
    }
    if (!is_array($data) || array_is_list($data)) {
        throw new RpsError('Ungültige Anfrage (JSON-Objekt erwartet).', 400);
    }
    return $data;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    rps_respond(405, ['error' => 'Nur POST ist erlaubt.']);
}

try {
    rps_respond(200, rps_handle(rps_db_open(), rps_read_body(), time()));
} catch (RpsError $e) {
    rps_respond($e->status(), ['error' => $e->getMessage()]);
} catch (PDOException $e) {
    // Keine Nutzerdaten ins Log: nur Klasse, Code und Ort.
    error_log(sprintf('rps api: PDOException %s at %s:%d', (string) $e->getCode(), basename($e->getFile()), $e->getLine()));
    rps_respond(503, ['error' => 'Der Server ist gerade ausgelastet. Bitte versuche es gleich noch einmal.']);
} catch (Throwable $e) {
    error_log(sprintf('rps api: %s at %s:%d', get_class($e), basename($e->getFile()), $e->getLine()));
    rps_respond(500, ['error' => 'Interner Fehler. Bitte versuche es gleich noch einmal.']);
}
