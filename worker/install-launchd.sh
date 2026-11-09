#!/bin/bash
# Keep the render worker running on this Mac without a terminal tab.
#
# Installs a launchd agent that starts the worker at login, restarts it within
# 30s if it ever exits, and runs it under `caffeinate -s` so the Mac does not
# sleep while it is plugged in (on battery, or with the lid closed and no
# external display, macOS still sleeps; nothing renders until it wakes).
#
#   bash worker/install-launchd.sh            install (or reinstall) and start
#   bash worker/install-launchd.sh uninstall  stop and remove
#
# Log: ~/Library/Logs/trackstar-render-worker.log
set -euo pipefail
LABEL=art.trackstar.render-worker
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/trackstar-render-worker.log"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then rm -f "$PLIST"; echo "Removed $LABEL"; exit 0; fi

NODE="$(command -v node)"
[ -x "$NODE" ] || { echo "node not found on PATH"; exit 1; }

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-s</string>
    <string>$NODE</string><string>$REPO/worker/render-worker.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. Log: $LOG"
echo "Check it: launchctl print gui/$(id -u)/$LABEL | grep state"
