#!/usr/bin/env bash
# Baut das Upload-Paket: dist/public/ + dist/rps-public-<sha>.zip
# Inhalt = public/ ohne Laufzeitdaten (*.sqlite*), ohne Dotfiles (außer .htaccess), ohne Editor-/OS-Müll.
#
# Aufruf:  npm run dist                     (Standard: prüft sauberes Arbeitsverzeichnis, Tests, gitleaks)
#          npm run dist -- --allow-dirty    (nur zum Ausprobieren; Paketname bekommt -dirty)
#          npm run dist -- --skip-tests     (nur zum Ausprobieren)
#          RPS_DATA_DIR=/abs/pfad npm run dist
#               → schreibt "SetEnv RPS_DATA_DIR …" in dist/public/.htaccess (DB außerhalb des Webroots)
# Braucht: bash, git, find, cp, und zip ODER bsdtar ODER python3; gitleaks lokal oder per Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_DIRTY=0
SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-tests)  SKIP_TESTS=1 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n▶ %s\n' "$*"; }
die()  { printf '✘ %s\n' "$*" >&2; exit 1; }

# --- 1. Arbeitsverzeichnis sauber? ---------------------------------------------------------
step "Arbeitsverzeichnis prüfen"
SHA=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain)" ]]; then
  if ((ALLOW_DIRTY)); then
    echo "⚠ Arbeitsverzeichnis nicht sauber – Paket wird als -dirty markiert (nicht hochladen!)"
    SHA="$SHA-dirty"
  else
    git status --short
    die "Arbeitsverzeichnis nicht sauber. Erst committen (oder --allow-dirty zum Ausprobieren)."
  fi
else
  echo "✔ sauber ($SHA)"
fi

# --- 2. Tests ---------------------------------------------------------------------------
if ((SKIP_TESTS)); then
  echo "⚠ Tests übersprungen (--skip-tests)"
else
  step "Tests (npm test)"
  npm test --silent >/dev/null 2>&1 || { npm test; die "Tests fehlgeschlagen."; }
  echo "✔ alle Tests grün"
fi

# --- 3. Secrets-Scan über public/ -------------------------------------------------------
step "gitleaks über public/"
if command -v gitleaks >/dev/null; then
  gitleaks dir --redact --no-banner --log-level warn --config .gitleaks.toml public \
    || die "gitleaks hat etwas gefunden."
else
  UID="$(id -u)" GID="$(id -g)" docker compose --profile tools run --rm -T gitleaks \
    dir --redact --no-banner --log-level warn --config .gitleaks.toml public \
    || die "gitleaks hat etwas gefunden (oder Docker fehlt)."
fi
echo "✔ keine Secrets gefunden"

# --- 4. Dateien auswählen und kopieren --------------------------------------------------
step "dist/public/ zusammenstellen"
# Gibt 0 zurück, wenn die Datei (Pfad relativ zu public/) NICHT ausgeliefert werden soll.
excluded() {
  local rel="$1" base="${1##*/}"
  case "/$rel" in
    */.well-known/*) ;;                 # erlaubt (z. B. security.txt)
    */.*/*) return 0 ;;                 # Dateien in versteckten Ordnern (.idea/, .git/ …)
  esac
  case "$base" in
    .htaccess) return 1 ;;
    .*) return 0 ;;                     # Dotfiles (.DS_Store, .env, .gitkeep …)
    *.sqlite|*.sqlite-*|*.sqlite3|*.sqlite3-*|*.db) return 0 ;;
    *~|*.swp|*.swo|*.bak|*.orig|*.tmp|*.log|*.md|*.sh) return 0 ;;
    Thumbs.db|desktop.ini|Icon$'\r') return 0 ;;
  esac
  return 1
}

rm -rf dist/public
mkdir -p dist/public
skipped=()
while IFS= read -r -d '' f; do
  rel="${f#public/}"
  if excluded "$rel"; then skipped+=("$rel"); continue; fi
  mkdir -p "dist/public/$(dirname "$rel")"
  cp -p "$f" "dist/public/$rel"
done < <(find public -type f -print0 | sort -z)

for s in "${skipped[@]+"${skipped[@]}"}"; do echo "  ausgelassen: $s"; done

# Pflichtdateien vorhanden?
for must in index.html api.php .htaccess manifest.webmanifest src/.htaccess data/.htaccess; do
  [[ -f "dist/public/$must" ]] || die "Pflichtdatei fehlt im Paket: $must"
done

# --- 5. optional: Datenverzeichnis außerhalb des Webroots -------------------------------
if [[ -n "${RPS_DATA_DIR:-}" ]]; then
  [[ "$RPS_DATA_DIR" == /* ]] || die "RPS_DATA_DIR muss ein absoluter Pfad sein."
  [[ "$RPS_DATA_DIR" != *'"'* ]] || die "RPS_DATA_DIR darf keine Anführungszeichen enthalten."
  printf '\n# Von scripts/dist.sh ergänzt: SQLite außerhalb des Webroots\n<IfModule mod_env.c>\n  SetEnv RPS_DATA_DIR "%s"\n</IfModule>\n' \
    "$RPS_DATA_DIR" >> dist/public/.htaccess
  echo "✔ SetEnv RPS_DATA_DIR \"$RPS_DATA_DIR\" in dist/public/.htaccess"
else
  echo "ℹ RPS_DATA_DIR nicht gesetzt → DB liegt auf dem Server in data/ (per .htaccess gesperrt)"
fi

# --- 6. Zip -----------------------------------------------------------------------------
step "Zip erstellen"
ZIP="dist/rps-public-$SHA.zip"
rm -f "$ZIP"
ZIP_ABS="$PWD/$ZIP"
if command -v zip >/dev/null; then
  (cd dist/public && zip -qrX "$ZIP_ABS" .)
elif command -v bsdtar >/dev/null; then
  (cd dist/public && find . -type f | sed 's#^\./##' | sort | bsdtar --format zip -cf "$ZIP_ABS" -T -)
elif command -v python3 >/dev/null; then
  python3 -I - "$ZIP_ABS" dist/public <<'PY'
import os, sys, zipfile
out, root = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in sorted(os.walk(root)):
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, root))
PY
else
  die "Weder zip, bsdtar noch python3 gefunden."
fi

# --- 7. Übersicht -----------------------------------------------------------------------
step "Inhalt von dist/public/"
find dist/public -type f -printf '%10s  %P\n' | sort -k2
count=$(find dist/public -type f | wc -l)
total=$(find dist/public -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
zipsize=$(stat -c %s "$ZIP")
human() { awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.2f MB", b/1048576; else printf "%.1f KB", b/1024 }'; }
printf '\n✔ %d Dateien, %s unkomprimiert (%d Bytes)\n' "$count" "$(human "$total")" "$total"
printf '✔ %s (%s)\n' "$ZIP" "$(human "$zipsize")"
printf '\nNächste Schritte: Inhalt von dist/public/ per FTP in den Dokumentenstamm laden,\n'
printf 'danach: npm run check:deploy -- https://rps.bastianswelt.de\n'
