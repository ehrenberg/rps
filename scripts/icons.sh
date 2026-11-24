#!/usr/bin/env bash
# Rendert die PNG-/ICO-Icons aus den SVG-Quellen in public/assets/img/.
# Nur bei Änderungen an icon.svg / icon-maskable.svg nötig; das Ergebnis wird committet.
# Nutzt rsvg-convert/ImageMagick lokal, sonst das Docker-Image dpokidov/imagemagick.
set -euo pipefail
cd "$(dirname "$0")/.."
IMG=public/assets/img

im() { # ImageMagick lokal oder per Docker (Arbeitsverzeichnis = Repo)
  if command -v magick >/dev/null; then
    magick "$@"
  else
    docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/w" -w /w dpokidov/imagemagick "$@"
  fi
}

render() { # render <svg> <größe> <ziel.png>
  if command -v rsvg-convert >/dev/null; then
    rsvg-convert -w "$2" -h "$2" "$1" -o "$3"
  else
    im -background none -density 1200 "$1" -resize "$2x$2" "$3"
  fi
  im "$3" -strip "$3"   # Metadaten (Zeitstempel) raus → reproduzierbar
}

render "$IMG/icon.svg"          192 "$IMG/icon-192.png"
render "$IMG/icon.svg"          512 "$IMG/icon-512.png"
render "$IMG/icon-maskable.svg" 192 "$IMG/icon-maskable-192.png"
render "$IMG/icon-maskable.svg" 512 "$IMG/icon-maskable-512.png"
# iOS rundet selbst ab und kann weder SVG noch Transparenz → vollflächige Variante
render "$IMG/icon-maskable.svg" 180 "$IMG/apple-touch-icon.png"

# favicon.ico (16/32/48) für Browser/Crawler, die /favicon.ico ungefragt abrufen
mkdir -p .icons-tmp
trap 'rm -rf .icons-tmp' EXIT
for s in 16 32 48; do render "$IMG/icon.svg" "$s" ".icons-tmp/$s.png"; done
im .icons-tmp/16.png .icons-tmp/32.png .icons-tmp/48.png public/favicon.ico

ls -l "$IMG"/*.png public/favicon.ico
