#!/usr/bin/env bash
# Render the app icons from the Nomad Karaoke square logo (transparent, 2500 px; copied from
# NomadBranding/Nomad-Karaoke-Logo-Square-Transparent.png) on a brand-blue radial gradient.
# Needs ImageMagick (brew install imagemagick). Run from the repo root.
set -euo pipefail
LOGO=apps/mobile/assets/brand/nomad-logo-square-transparent.png
OUT=apps/mobile/assets/images
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Brand blue #230a89 with a slightly lighter centre, like the logo's own background.
magick -size 1024x1024 radial-gradient:'#33159f'-'#230a89' "$TMP/bg.png"

# iOS / default icon: the square logo, full bleed (iOS rounds the corners).
magick "$TMP/bg.png" \( "$LOGO" -resize 1024x1024 \) -gravity center -composite -alpha off "$OUT/icon.png"

# Android adaptive icon: launchers show only the middle 2/3 of the 1024 canvas, masked (often a circle).
# Size the logo so its text block sits inside that circle, like Nomad-Karaoke-Logo-Circle-1000.png.
magick -size 1024x1024 xc:none \( "$LOGO" -resize 670x670 \) -gravity center -composite "$OUT/android-icon-foreground.png"
cp "$TMP/bg.png" "$OUT/android-icon-background.png"
# Themed (monochrome) icon: the logo's silhouette in white.
magick "$OUT/android-icon-foreground.png" -alpha extract -background white -alpha shape "$OUT/android-icon-monochrome.png"

# Splash image (shown on brand blue) and web favicon.
magick "$LOGO" -resize 1024x1024 "$OUT/splash-icon.png"
magick "$OUT/icon.png" -resize 48x48 "$OUT/favicon.png"
echo "icons written to $OUT"
