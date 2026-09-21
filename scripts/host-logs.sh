#!/bin/sh
# Shows what the bot has been doing.   sh /data/bot/scripts/host-logs.sh
. "$(dirname "$0")/host-common.sh"

if bot_running; then echo "Bot: RUNNING"; elif [ -f .paused ]; then echo "Bot: STOPPED (run host-start.sh)"; else echo "Bot: NOT RUNNING"; fi
if pg_running; then echo "Database: RUNNING"; else echo "Database: NOT RUNNING"; fi
LATEST=$(ls -1 logs/bot-*.log 2>/dev/null | tail -n 1)
if [ -n "$LATEST" ]; then
  echo ""
  echo "----- last 25 lines of $LATEST -----"
  tail -n 25 "$LATEST"
fi
if [ -f bot-console.log ]; then
  echo ""
  echo "----- last 10 lines of bot-console.log (startup messages and crashes) -----"
  tail -n 10 bot-console.log
fi
