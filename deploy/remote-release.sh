#!/usr/bin/env bash
#
# Aktiviert ein hochgeladenes Release auf dem Server (netcup Webhosting).
# Der Deploy-Workflow schickt dieses Skript per SSH an die Server-Shell:
#
#   ssh <host> "bash -s -- /rps <release>" < deploy/remote-release.sh
#
# netcup/Plesk: Die SSH-Sitzung ist abgeschottet (chroot), der Webspace erscheint dort als „/“,
# PHP-FPM sieht dagegen /var/www/vhosts/<webspace>/… . Deshalb nur relative Symlinks.
#
# Struktur unter BASE_DIR (siehe docs/DEPLOYMENT.md):
#   releases/<release>/   Inhalt von dist/public/ (Paket aus scripts/dist.sh)
#     data -> ../../shared/data
#   shared/data/          SQLite-Datenbank, bleibt über alle Releases erhalten
#   current -> releases/<release>   = Document Root der Subdomain, wird atomar umgestellt
#
# Idempotent: Ein zweiter Lauf mit demselben Release ändert nichts Schädliches.

set -euo pipefail

BASE_DIR="${1:?Aufruf: remote-release.sh <BASE_DIR> <RELEASE>}"
RELEASE="${2:?Aufruf: remote-release.sh <BASE_DIR> <RELEASE>}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

[[ "$RELEASE" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo "FEHLER: ungültiger Release-Name $RELEASE" >&2; exit 1; }

BASE_DIR="$(cd "$BASE_DIR" && pwd -P)"
RELEASE_DIR="$BASE_DIR/releases/$RELEASE"
SHARED_DATA="$BASE_DIR/shared/data"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }

[[ -d "$RELEASE_DIR" ]] || fail "Release-Ordner $RELEASE_DIR fehlt."
for must in index.html api.php .htaccess src/.htaccess data/.htaccess; do
  [[ -e "$RELEASE_DIR/$must" ]] || fail "$RELEASE_DIR ist kein vollständiges rps-Paket ($must fehlt)."
done

# 0. Plesk legt den Document Root (current) beim Einrichten der Subdomain als echten Ordner an.
#    Der muss weg, damit current ein Symlink werden kann. Nur leere Ordner werden entfernt, sonst Abbruch.
if [[ -d "$BASE_DIR/current" && ! -L "$BASE_DIR/current" ]]; then
  if [[ -n "$(find "$BASE_DIR/current" -mindepth 1 ! -type d -print -quit)" ]]; then
    fail "$BASE_DIR/current ist ein echter Ordner mit Dateien – bitte prüfen und von Hand entfernen."
  fi
  log "Leeren Plesk-Ordner current/ entfernen"
  find "$BASE_DIR/current" -depth -type d -empty -delete
fi

# 1. Geteilter Datenordner: bleibt über Releases erhalten. Die Sperr-Dateien aus dem Paket immer
#    aktualisieren, damit er auch über den data/-Symlink im Webroot nie ausgeliefert wird.
log "Datenordner shared/data prüfen"
mkdir -p "$SHARED_DATA"
if [[ ! -L "$RELEASE_DIR/data" ]]; then # bei einem zweiten Lauf ist data/ schon der Symlink
  cp -f "$RELEASE_DIR/data/.htaccess" "$SHARED_DATA/.htaccess"
  if [[ -f "$RELEASE_DIR/data/index.html" ]]; then cp -f "$RELEASE_DIR/data/index.html" "$SHARED_DATA/index.html"; fi
fi

# 2. data/ im Release durch relativen Symlink auf shared/data ersetzen. Greift, wenn RPS_DATA_DIR
#    nicht gesetzt ist (Fallback in src/db.php); mit RPS_DATA_DIR zeigt die Variable auf denselben Ordner.
log "data -> ../../shared/data"
rm -rf "$RELEASE_DIR/data"
ln -sfn ../../shared/data "$RELEASE_DIR/data"

# 3. current atomar umstellen: temporären Symlink anlegen, dann per rename() ersetzen.
log "current -> releases/$RELEASE"
ln -sfn "releases/$RELEASE" "$BASE_DIR/current.tmp"
mv -Tf "$BASE_DIR/current.tmp" "$BASE_DIR/current"

# 4. Alte Releases aufräumen: die neuesten KEEP_RELEASES behalten, das aktive nie löschen.
#    Ohne Prozess-Substitution „< <(…)“: Die abgeschottete netcup-Umgebung hat kein /dev/fd.
log "Alte Releases aufräumen (behalte $KEEP_RELEASES)"
active="$(basename "$(readlink "$BASE_DIR/current")")"
old_releases="$(find "$BASE_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n "+$((KEEP_RELEASES + 1))")"
while IFS= read -r old; do
  [[ -z "$old" || "$old" == "$active" ]] && continue
  [[ "$old" =~ ^[0-9]{8}-[0-9]{6}$ ]] || continue # nur Release-Ordner mit Zeitstempel-Namen anfassen
  log "  entferne releases/$old"
  rm -rf "${BASE_DIR:?}/releases/${old:?}"
done <<<"$old_releases"

log "Release $RELEASE ist aktiv."
