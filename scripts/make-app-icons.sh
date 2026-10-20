#!/usr/bin/env bash
# Render the app icons from the vector Nomad "N" mark (apps/mobile/assets/brand/nomad-n-mark.svg).
# Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick). Run from the repo root.
set -euo pipefail
SVG=apps/mobile/assets/brand/nomad-n-mark.svg
OUT=apps/mobile/assets/images
BLUE='#230a89'
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

mark() { rsvg-convert -w "$1" -h "$1" "$SVG" -o "$2"; }   # mark on transparent, square canvas

# iOS / default icon: 1024, opaque, mark at ~78% on brand blue (iOS rounds the corners itself).
mark 800 "$TMP/m800.png"
magick -size 1024x1024 "xc:$BLUE" "$TMP/m800.png" -gravity center -composite -alpha off "$OUT/icon.png"

# Android adaptive icon: 1024 foreground with the mark inside the 66% safe zone, brand-blue background.
mark 580 "$TMP/m580.png"
magick -size 1024x1024 xc:none "$TMP/m580.png" -gravity center -composite "$OUT/android-icon-foreground.png"
magick -size 512x512 "xc:$BLUE" "$OUT/android-icon-background.png"
# Themed (monochrome) icon: the mark's silhouette in white.
magick "$OUT/android-icon-foreground.png" -alpha extract -background white -alpha shape "$OUT/android-icon-monochrome.png"

# Splash image (shown on brand blue) and web favicon.
mark 1024 "$OUT/splash-icon.png"
magick -size 48x48 "xc:$BLUE" \( "$TMP/m800.png" -resize 40x40 \) -gravity center -composite "$OUT/favicon.png"
echo "icons written to $OUT"
