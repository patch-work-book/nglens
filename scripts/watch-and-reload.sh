#!/bin/bash
# Chrome Extension Auto-Reload Script
# 
# This script watches the dist/panel folder and triggers extension reload via osascript
# 
# Setup:
# 1. Make sure Chrome is open and extension is loaded
# 2. Run: chmod +x scripts/watch-and-reload.sh && npm run dev:panel & ./scripts/watch-and-reload.sh

DIST_PATH="dist/panel"
EXTENSION_ID="${EXTENSION_ID:-undefined}" # Set via environment variable

echo "👀 Watching $DIST_PATH for changes..."
echo "💡 Extension auto-reload will trigger on file changes"
echo "⚠️  Make sure Chrome is in focus for AppleScript to work"
echo ""

fswatch -r "$DIST_PATH" --event Updated | while read -r event; do
  # Skip dotfiles and source maps
  if [[ "$event" == .* ]] || [[ "$event" == *".map"* ]]; then
    continue
  fi
  
  echo "📝 Changed: $(basename $event)"
  
  # Reload Chrome extension via AppleScript (macOS only)
  osascript <<EOF
    tell application "Google Chrome"
      activate
      tell application "System Events"
        keystroke "r" using {command down, option down}
      end tell
    end tell
EOF
  
  echo "✨ Sent reload signal to Chrome"
done
