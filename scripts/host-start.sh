#!/bin/sh
# Starts (or resumes) the bot.   sh /data/bot/scripts/host-start.sh
. "$(dirname "$0")/host-common.sh"

rm -f .paused
if boot_running; then
  echo "Bot started. Check it with: tail -n 30 $BOT_DIR/bot-console.log"
  exit 0
fi
nohup sh scripts/host-boot.sh >/dev/null 2>&1 &
sleep 5
echo "Bot started in the background. Check it with: tail -n 30 $BOT_DIR/bot-console.log"
