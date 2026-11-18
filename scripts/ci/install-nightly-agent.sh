#!/usr/bin/env bash
# Install (or update) the build host's LaunchAgent that starts the nightly E2E run at 03:00 local time.
#   ssh andrewmastech 'bash -s' < scripts/ci/install-nightly-agent.sh
# Copies nightly-dispatch.sh to ~/bin (the runner checkouts are wiped per job), writes the plist and loads it.
# The token goes in ~/.config/nomad-ci/nomad-mobile-dispatch-token separately (see nightly-dispatch.sh).
set -euo pipefail
LABEL=com.nomadkaraoke.mobile-nightly-e2e
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC_URL=https://raw.githubusercontent.com/nomadkaraoke/nomad-mobile/main/scripts/ci/nightly-dispatch.sh
mkdir -p "$HOME/bin" "$HOME/.config/nomad-ci" "$HOME/Library/Logs"
chmod 700 "$HOME/.config/nomad-ci"
curl -fsSL "$SRC_URL" -o "$HOME/bin/nomad-mobile-nightly-dispatch.new"
chmod +x "$HOME/bin/nomad-mobile-nightly-dispatch.new"
mv "$HOME/bin/nomad-mobile-nightly-dispatch.new" "$HOME/bin/nomad-mobile-nightly-dispatch"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$HOME/bin/nomad-mobile-nightly-dispatch</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/nomad-mobile-nightly.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/nomad-mobile-nightly.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (03:00 daily); log ~/Library/Logs/nomad-mobile-nightly.log"
[[ -r "$HOME/.config/nomad-ci/nomad-mobile-dispatch-token" ]] || echo "NOTE: token missing: ~/.config/nomad-ci/nomad-mobile-dispatch-token"
