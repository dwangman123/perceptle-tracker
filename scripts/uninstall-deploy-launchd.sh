#!/bin/sh
# Stop the nightly upload. The site stays online with its last scores;
# delete the Vercel project (vercelProject in config.json) in the dashboard to take it down.
set -eu
LABEL="com.perceptle-tracker.deploy"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed $LABEL"
