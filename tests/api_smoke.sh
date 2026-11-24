#!/usr/bin/env bash
# HTTP-Smoke-Test: kompletter Duell-Durchlauf gegen einen laufenden Server.
# Aufruf: tests/api_smoke.sh [BASE_URL]   (Default: http://localhost:8088 = docker compose web)
# Braucht nur curl, sed, sha256sum. Tokens/Nonces entstehen zur Laufzeit.
set -euo pipefail

BASE="${1:-${RPS_BASE_URL:-http://localhost:8088}}"
API="$BASE/api.php"
PASS=0

fail() { echo "✘ $*" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); echo "✔ $*"; }

# post JSON → setzt $STATUS und $BODY
post() {
  local out
  out=$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$1" "$API")
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}
field() { sed -n 's/.*"'"$1"'":"\([^"]*\)".*/\1/p' <<<"$BODY"; }
num() { sed -n 's/.*"'"$1"'":\([0-9]*\).*/\1/p' <<<"$BODY" | head -n1; }
expect_status() { [[ "$STATUS" == "$1" ]] || fail "$2: HTTP $STATUS statt $1 – $BODY"; ok "$2"; }
nonce() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# --- HTTP-Schicht ---
code=$(curl -s -o /dev/null -w '%{http_code}' "$API")
[[ "$code" == 405 ]] || fail "GET sollte 405 liefern ($code)"; ok "GET → 405"
headers=$(curl -s -D - -o /dev/null -X POST --data-binary '{}' "$API")
grep -qi '^content-type: application/json; charset=utf-8' <<<"$headers" || fail "Content-Type fehlt"
grep -qi '^cache-control: no-store' <<<"$headers" || fail "Cache-Control fehlt"
ok "Header Content-Type/Cache-Control"
post 'kein json'; expect_status 400 "Kaputtes JSON → 400"
post "{\"action\":\"create\",\"name\":\"$(head -c 5000 /dev/zero | tr '\0' 'a')\"}"; expect_status 413 "Body > 4 KB → 413"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/src/db.php")
[[ "$code" == 403 || "$code" == 404 ]] || fail "src/ ist erreichbar ($code)"; ok "src/ gesperrt"

# --- Duell ---
post '{"action":"create","type":"duel","name":"Anna","variant":"classic","bestOf":3}'
expect_status 200 "create"
ROOM=$(field code); TA=$(field token); A=$(field me)
post "{\"action\":\"info\",\"code\":\"$ROOM\"}"; expect_status 200 "info (ohne Token)"
grep -q '"hostName":"Anna"' <<<"$BODY" && grep -q '"joinable":true' <<<"$BODY" || fail "info falsch: $BODY"
if grep -q "$A" <<<"$BODY"; then fail "info enthält Spieler-ID"; fi
ok "info: Host, beitretbar, keine IDs"
post '{"action":"info","code":"zzzzzz"}'
expect_status 404 "info unbekannter Raum → 404"
post "{\"action\":\"join\",\"code\":\"$ROOM\",\"name\":\"Ben\"}"
expect_status 200 "join"; TB=$(field token)
post "{\"action\":\"join\",\"code\":\"$ROOM\",\"name\":\"Carl\"}"; expect_status 409 "dritter Spieler → 409"
post "{\"action\":\"info\",\"code\":\"$ROOM\"}"
grep -q '"joinable":false' <<<"$BODY" && grep -q '"players":2' <<<"$BODY" || fail "info nach Beitritt falsch: $BODY"
ok "info: Duell voll"

post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TA\"}"
expect_status 200 "state"
grep -q '"status":"running"' <<<"$BODY" || fail "Match läuft nicht: $BODY"
V=$(num version)
post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TA\",\"since\":$V}"
grep -q '"unchanged":true' <<<"$BODY" || fail "unchanged erwartet: $BODY"; ok "state since → unchanged"

play_round() { # $1 Zug Anna, $2 Zug Ben
  local na nb
  na=$(nonce); nb=$(nonce)
  post "{\"action\":\"commit\",\"code\":\"$ROOM\",\"token\":\"$TA\",\"hash\":\"$(sha "$1:$na")\"}"; expect_status 200 "commit A ($1)"
  post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TB\"}"
  grep -q '"commitDeadline":[0-9]' <<<"$BODY" || fail "commitDeadline fehlt: $BODY"
  post "{\"action\":\"commit\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"hash\":\"$(sha "$2:$nb")\"}"; expect_status 200 "commit B ($2)"
  post "{\"action\":\"reveal\",\"code\":\"$ROOM\",\"token\":\"$TA\",\"move\":\"$1\",\"nonce\":\"$na\"}"; expect_status 200 "reveal A"
  # Fairness: B darf A's Zug/Nonce jetzt noch nicht sehen.
  post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TB\"}"
  if grep -q "$na" <<<"$BODY"; then fail "Nonce von A vor B's Reveal sichtbar!"; fi
  grep -q '"revealed":\[true,false\]' <<<"$BODY" || fail "revealed-Flags falsch: $BODY"
  ok "Fairness: kein Zug vor beidseitigem Reveal"
  post "{\"action\":\"reveal\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"move\":\"$2\",\"nonce\":\"$na\"}"; expect_status 400 "falsche Nonce → 400"
  post "{\"action\":\"reveal\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"move\":\"$2\",\"nonce\":\"$nb\"}"; expect_status 200 "reveal B"
  post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TB\"}"
  grep -q "$na" <<<"$BODY" || fail "Nonce fehlt in history"
}
play_round rock rock
play_round rock scissors
play_round paper rock
grep -q '"winner":0' <<<"$BODY" && grep -q '"end":"score"' <<<"$BODY" || fail "Match nicht beendet: $BODY"
grep -q "\"$A\":1" <<<"$BODY" || fail "Serie nicht gezählt"
ok "Match beendet, Serie 1:0"

post "{\"action\":\"rematch\",\"code\":\"$ROOM\",\"token\":\"$TA\"}"; expect_status 200 "rematch A"
post "{\"action\":\"rematch\",\"code\":\"$ROOM\",\"token\":\"$TB\"}"; expect_status 200 "rematch B"
post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TA\"}"
grep -q '"current":"m2"' <<<"$BODY" || fail "Revanche nicht gestartet"; ok "Revanche → m2"

post "{\"action\":\"react\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"emoji\":\"🔥\"}"; expect_status 200 "react"
post "{\"action\":\"react\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"emoji\":\"🔥\"}"
# Sekundengrenze erwischt? Dann sofort noch einmal.
[[ "$STATUS" == 200 ]] && post "{\"action\":\"react\",\"code\":\"$ROOM\",\"token\":\"$TB\",\"emoji\":\"🔥\"}"
expect_status 429 "react zu schnell → 429"
post "{\"action\":\"claim\",\"code\":\"$ROOM\",\"token\":\"$TA\"}"; expect_status 409 "claim zu früh → 409"
grep -q '"error":"' <<<"$BODY" || fail "Fehler ohne error-Feld"
post "{\"action\":\"leave\",\"code\":\"$ROOM\",\"token\":\"$TB\"}"; expect_status 200 "leave"
post "{\"action\":\"state\",\"code\":\"$ROOM\",\"token\":\"$TA\"}"
grep -q '"end":"leave"' <<<"$BODY" || fail "leave nicht gewertet"; ok "Gegner gewinnt nach leave"

echo; echo "$PASS Prüfungen bestanden"
