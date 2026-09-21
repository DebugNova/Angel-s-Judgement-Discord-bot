#!/bin/sh
# Stops the bot started by host-start.sh (PostgreSQL keeps running).
cd "$(dirname "$0")/.."
if [ -f .bot.pid ]; then
  kill "$(cat .bot.pid)" 2>/dev/null
  rm -f .bot.pid
fi
pkill -f "node dist/index.js" 2>/dev/null
sleep 2
echo "Bot stopped."
