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
const RPS_ROOM_TTL = 86400;          // Räume sind nach 24 h weg (ab Erstellung, hart)
const RPS_LOBBY_TTL = 3600;          // Lobby-Räume ohne Änderung so lange behalten
const RPS_LOBBY_EVICT_AGE = 600;     // bei vollem Limit: Lobby-Räume ab diesem Alter verdrängen
const RPS_MAX_ROOMS = 5000;
const RPS_VACUUM_PAGES = 64;         // freie Seiten pro incremental_vacuum

function rps_db_open(string $dir = RPS_DATA_DIR): PDO
{
    $pdo = new PDO('sqlite:' . rtrim($dir, '/') . '/' . RPS_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => intdiv(RPS_DB_BUSY_MS, 1000),
    ]);
    $pdo->exec('PRAGMA busy_timeout = ' . RPS_DB_BUSY_MS);
    $pdo->exec('PRAGMA secure_delete = ON');
    // Muss vor dem Anlegen der Tabellen gesetzt sein (wirkt nur bei neuer DB-Datei).
    $pdo->exec('PRAGMA auto_vacuum = INCREMENTAL');
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
        updated INTEGER NOT NULL,
        status  TEXT NOT NULL DEFAULT \'lobby\'
    )');
    if (!in_array('status', array_column($pdo->query('PRAGMA table_info(rooms)')->fetchAll(), 'name'), true)) {
        $pdo->exec('ALTER TABLE rooms ADD COLUMN status TEXT NOT NULL DEFAULT \'lobby\'');
    }
    $pdo->exec('CREATE INDEX IF NOT EXISTS rooms_updated ON rooms(updated)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS rooms_created ON rooms(created)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS rooms_status_updated ON rooms(status, updated)');
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

/** Lädt einen Raum; abgelaufene Räume (älter als 24 h) gelten als nicht vorhanden. @return array{room:array,version:int}|null */
function rps_db_load_room(PDO $pdo, string $code, int $now): ?array
{
    $st = $pdo->prepare('SELECT data, version FROM rooms WHERE code = ? AND created >= ?');
    $st->execute([$code, $now - RPS_ROOM_TTL]);
    $row = $st->fetch();
    if ($row === false) {
        return null;
    }
    return ['room' => json_decode($row['data'], true, 64, JSON_THROW_ON_ERROR), 'version' => (int) $row['version']];
}

/** Legt einen Raum an. false, wenn der Code schon vergeben ist. */
function rps_db_insert_room(PDO $pdo, string $code, array $room, int $now): bool
{
    $st = $pdo->prepare('INSERT OR IGNORE INTO rooms (code, data, version, created, updated, status) VALUES (?, ?, 1, ?, ?, ?)');
    $st->execute([$code, rps_db_encode($room), $now, $now, $room['status']]);
    return $st->rowCount() === 1;
}

function rps_db_save_room(PDO $pdo, string $code, array $room, int $version, int $now): void
{
    $st = $pdo->prepare('UPDATE rooms SET data = ?, version = ?, updated = ?, status = ? WHERE code = ?');
    $st->execute([rps_db_encode($room), $version, $now, $room['status'], $code]);
}

function rps_db_encode(array $room): string
{
    return json_encode($room, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function rps_db_count_rooms(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM rooms')->fetchColumn();
}

/**
 * Löscht abgelaufene Räume: älter als 24 h (ab Erstellung), 24 h unverändert oder
 * verwaiste Lobbys (1 h unverändert). Gibt danach freie Seiten schrittweise zurück.
 * @return int Anzahl gelöschter Räume
 */
function rps_db_cleanup(PDO $pdo, int $now): int
{
    $st = $pdo->prepare("DELETE FROM rooms WHERE created < ? OR updated < ? OR (status = 'lobby' AND updated < ?)");
    $st->execute([$now - RPS_ROOM_TTL, $now - RPS_ROOM_TTL, $now - RPS_LOBBY_TTL]);
    $deleted = $st->rowCount();
    if ($deleted > 0) {
        rps_db_incremental_vacuum($pdo);
    }
    return $deleted;
}

/** Verdrängt die ältesten inaktiven Lobby-Räume (≥ 10 min unverändert). @return int Anzahl */
function rps_db_evict_idle_lobbies(PDO $pdo, int $now, int $count): int
{
    $st = $pdo->prepare("DELETE FROM rooms WHERE code IN (
        SELECT code FROM rooms WHERE status = 'lobby' AND updated < ? ORDER BY updated LIMIT ?
    )");
    $st->execute([$now - RPS_LOBBY_EVICT_AGE, $count]);
    return $st->rowCount();
}

function rps_db_incremental_vacuum(PDO $pdo): void
{
    $pdo->query('PRAGMA incremental_vacuum(' . RPS_VACUUM_PAGES . ')')->fetchAll();
}
