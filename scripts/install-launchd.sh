#!/bin/sh
# Install (or reinstall) the nightly scan as a launchd agent: runs at 00:00
# local time; if the Mac is asleep then, launchd runs it once on wake.
set -eu
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.perceptle-tracker.scan"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$PROJECT/bin/perceptle-scan"

[ -x "$BIN" ] || { echo "missing $BIN; run scripts/build.sh first" >&2; exit 1; }
mkdir -p "$PROJECT/logs" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>scan</string>
    <string>--home</string>
    <string>$PROJECT</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>0</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$PROJECT/logs/scan.log</string>
  <key>StandardErrorPath</key><string>$PROJECT/logs/scan.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST"
echo "run now:  launchctl kickstart -k gui/$(id -u)/$LABEL"
