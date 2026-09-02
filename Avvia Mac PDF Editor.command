#!/bin/zsh

EDITOR_DIRECTORY="${0:A:h}"
ELECTRON_BINARY="$EDITOR_DIRECTORY/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [[ ! -x "$ELECTRON_BINARY" ]]; then
  osascript -e 'display alert "Mac PDF Editor" message "Electron non è installato. Esegui prima pnpm install nella cartella del progetto." as critical'
  exit 1
fi

exec "$ELECTRON_BINARY" "$EDITOR_DIRECTORY"
