#!/bin/bash
# Double-click to play.
# Browsers won't let a page opened straight from disk load its models, textures and sounds,
# so this serves the folder locally and opens the game.
# With Google Chrome installed it opens as its own fullscreen window (no tabs or address bar);
# otherwise it opens in your default browser and goes fullscreen on your first click.
cd "$(dirname "$0")"
PORT=8123
URL="http://localhost:$PORT/index.html"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
echo "Starting Strikepoint at $URL  (close this window to stop the game server)"
(
  sleep 1
  if [ -x "$CHROME" ]; then
    # a separate profile so the fullscreen app flags always apply (your progress is saved there)
    "$CHROME" --user-data-dir="$HOME/Library/Application Support/Strikepoint" --app="$URL" \
      --start-fullscreen --no-first-run --no-default-browser-check >/dev/null 2>&1 &
  else
    open "$URL"
  fi
) &
python3 -m http.server $PORT --bind 127.0.0.1
