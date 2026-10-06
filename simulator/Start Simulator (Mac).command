#!/bin/bash
# Tactura Sim launcher for macOS. Double-click to start.
# First run installs dependencies; later runs start in a few seconds.

cd "$(dirname "$0")" || exit 1

hold() {
  echo
  read -r -n 1 -s -p "  Press any key to close this window..."
  echo
  exit 1
}

# Terminal windows opened from Finder can miss Homebrew or nvm paths.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

printf '\033]0;Tactura Sim\007'

cat <<'BANNER'

  ooooo  ooo   ooo  ooooo o   o oooo   ooo       oooo  ooo  o   o
    o   o   o o   o   o   o   o o   o o   o     o       o   oo oo
    o   o   o o       o   o   o o   o o   o     o       o   o o o
    o   ooooo o       o   o   o oooo  ooooo      ooo    o   o o o
    o   o   o o       o   o   o o o   o   o         o   o   o   o
    o   o   o o   o   o   o   o o  o  o   o         o   o   o   o
    o   o   o  ooo    o    ooo  o   o o   o     oooo   ooo  o   o

  TACTURA / SIM  -  Galaxy Watch simulator

BANNER

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js was not found on this Mac."
  echo "  Tactura Sim needs Node.js 20.19 or newer. The LTS version is best."
  echo "  Opening the download page now. Install it, then double-click this file again."
  open "https://nodejs.org/en/download"
  hold
fi

if ! node -e "var v=process.versions.node.split('.').map(Number);process.exit((v[0]===20&&v[1]>=19)||(v[0]===22&&v[1]>=12)||v[0]>=23?0:1)"; then
  echo "  Node.js $(node -v) is too old. Tactura Sim needs 20.19+ or 22.12+."
  echo "  Opening the download page now. Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  hold
fi

echo "  NODE ......... $(node -v)"

if ! node tools/ensure-deps.mjs; then
  echo
  echo "  ERROR: installing dependencies failed. See the messages above."
  echo "  Check your internet connection and try again."
  hold
fi

echo
echo "  Starting the simulator. Your browser will open automatically."
echo "  Press Ctrl+C to stop the simulator."
echo
npx vite --open
status=$?

# 130 means Ctrl+C, which is the normal way to stop.
if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
  echo
  echo "  ERROR: the simulator stopped unexpectedly (exit $status). See the messages above."
  hold
fi
