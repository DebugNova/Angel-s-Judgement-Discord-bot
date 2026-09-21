#!/bin/sh
# Starts the bot in the background on a Linux host and keeps it running (restarts it if it crashes).
#   sh scripts/host-start.sh     start (does nothing if it's already running)
#   sh scripts/host-stop.sh      stop
# Console output goes to bot-console.log; the bot's own logs are in logs/.
cd "$(dirname "$0")/.."

if [ "$1" = "--foreground" ]; then
  while true; do
    node dist/index.js
    echo "$(date -u) Bot stopped (exit $?). Restarting in 10 seconds..."
    sleep 10
  done
fi

if [ -f .bot.pid ] && kill -0 "$(cat .bot.pid)" 2>/dev/null; then
  echo "The bot is already running. To restart: sh scripts/host-stop.sh && sh scripts/host-start.sh"
  exit 0
fi

. scripts/host-pg.sh
find_pg_bin
start_pg

nohup sh scripts/host-start.sh --foreground >>bot-console.log 2>&1 &
echo $! >.bot.pid
echo "Bot started in the background. Watch it with: tail -f bot-console.log"
