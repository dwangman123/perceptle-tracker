#!/bin/sh
# Install (or reinstall) the upload as a launchd agent. It runs whenever a
# scan rewrites data/export.json (nightly, on wake, or by hand), and once an
# hour as a backup; deploy.sh skips quietly when nothing changed. Kept separate
# from the scan job so the scanner's Full Disk Access grant is untouched.
set -eu
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.perceptle-tracker.deploy"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# launchd starts with a bare PATH, so record where vercel (and its node) live now.
VERCEL="$(command -v vercel)" || { echo "vercel not found; npm install -g vercel" >&2; exit 1; }
TOOLS_PATH="$(dirname "$VERCEL"):/usr/local/bin:/usr/bin:/bin"
mkdir -p "$PROJECT/logs" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$PROJECT/scripts/deploy.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$TOOLS_PATH</string>
  </dict>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <!-- The scan replaces export.json by renaming a temp file over it, which
       changes the data/ folder itself, so watch the folder, not the file. -->
  <key>WatchPaths</key>
  <array>
    <string>$PROJECT/data</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$PROJECT/logs/deploy.log</string>
  <key>StandardErrorPath</key><string>$PROJECT/logs/deploy.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST"
echo "run now:  launchctl kickstart -k gui/$(id -u)/$LABEL"
