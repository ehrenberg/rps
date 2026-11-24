<?php
// PDO/SQLite: Verbindung, Schema, Transaktionen, Raum laden/speichern, Aufräumen.
// Einziger Ort mit SQL – ausschließlich Prepared Statements.
declare(strict_types=1);

if (!defined('RPS_DATA_DIR')) {
    // Pfad zur SQLite-Datei; für Tests per Umgebungsvariable überschreibbar.
    $rpsEnvDir = getenv('RPS_DATA_DIR');
    define('RPS_DATA_DIR', is_string($rpsEnvDir) && $rpsEnvDir !== '' ? $rpsEnvDir : __DIR__ . '/../data');
    unset($rpsEnvDir);
}

const RPS_DB_FILE = 'rps.sqlite';
const RPS_DB_BUSY_MS = 3000;
const RPS_ROOM_TTL = 86400;   // Räume ohne Änderung so lange behalten (Sekunden)
const RPS_MAX_ROOMS = 5000;

function rps_db_open(string $dir = RPS_DATA_DIR): PDO
{
    $pdo = new PDO('sqlite:' . rtrim($dir, '/') . '/' . RPS_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => intdiv(RPS_DB_BUSY_MS, 1000),
    ]);
    $pdo->exec('PRAGMA busy_timeout = ' . RPS_DB_BUSY_MS);
    rps_db_journal_mode($pdo);
    rps_db_schema($pdo);
    return $pdo;
}

/** WAL, falls das Dateisystem es kann – sonst klassisches Rollback-Journal. */
function rps_db_journal_mode(PDO $pdo): void
{
    try {
        $mode = $pdo->query('PRAGMA journal_mode = WAL')->fetchColumn();
        if (is_string($mode) && strtolower($mode) === 'wal') {
            $pdo->exec('PRAGMA synchronous = NORMAL');
            return;
        }
    } catch (PDOException) {
        // Fallback unten
    }
    $pdo->exec('PRAGMA journal_mode = DELETE');
}

function rps_db_schema(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS rooms (
        code    TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        version INTEGER NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS rooms_updated ON rooms(updated)');
}

/**
 * Führt $fn in BEGIN IMMEDIATE aus (Schreibsperre ab Beginn), COMMIT oder ROLLBACK.
 * @template T
 * @param callable():T $fn
 * @return T
 */
function rps_db_transaction(PDO $pdo, callable $fn): mixed
{
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $result = $fn();
        $pdo->exec('COMMIT');
        return $result;
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}

/** @return array{room:array,version:int}|null */
function rps_db_load_room(PDO $pdo, string $code): ?array
{
    $st = $pdo->prepare('SELECT data, version FROM rooms WHERE code = ?');
    $st->execute([$code]);
    $row = $st->fetch();
    if ($row === false) {
        return null;
    }
    return ['room' => json_decode($row['data'], true, 64, JSON_THROW_ON_ERROR), 'version' => (int) $row['version']];
}

/** Legt einen Raum an. false, wenn der Code schon vergeben ist. */
function rps_db_insert_room(PDO $pdo, string $code, array $room, int $now): bool
{
    $st = $pdo->prepare('INSERT OR IGNORE INTO rooms (code, data, version, created, updated) VALUES (?, ?, 1, ?, ?)');
    $st->execute([$code, rps_db_encode($room), $now, $now]);
    return $st->rowCount() === 1;
}

function rps_db_save_room(PDO $pdo, string $code, array $room, int $version, int $now): void
{
    $st = $pdo->prepare('UPDATE rooms SET data = ?, version = ?, updated = ? WHERE code = ?');
    $st->execute([rps_db_encode($room), $version, $now, $code]);
}

function rps_db_encode(array $room): string
{
    return json_encode($room, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function rps_db_count_rooms(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM rooms')->fetchColumn();
}

/** Löscht Räume, die seit 24 h nicht geändert wurden. @return int Anzahl gelöschter Räume */
function rps_db_cleanup(PDO $pdo, int $now): int
{
    $st = $pdo->prepare('DELETE FROM rooms WHERE updated < ?');
    $st->execute([$now - RPS_ROOM_TTL]);
    return $st->rowCount();
}

function rps_db_vacuum(PDO $pdo): void
{
    $pdo->exec('VACUUM');
}
