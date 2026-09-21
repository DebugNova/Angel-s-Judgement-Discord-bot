#!/bin/sh
# Stops the bot (the database keeps running) and keeps it stopped until host-start.sh.
#   sh /data/bot/scripts/host-stop.sh
. "$(dirname "$0")/host-common.sh"

touch .paused
if bot_running; then
  pkill -TERM -f "$BOT_CMD"
  i=0
  while bot_running && [ $i -lt 30 ]; do
    sleep 1
    i=$((i + 1))
  done
  if bot_running; then
    pkill -KILL -f "$BOT_CMD"
  fi
fi
echo "Bot stopped. Start it again with: sh $BOT_DIR/scripts/host-start.sh"
