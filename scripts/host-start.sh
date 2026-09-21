#!/bin/sh
# Starts (or resumes) the bot.   sh /data/bot/scripts/host-start.sh
. "$(dirname "$0")/host-common.sh"

if [ ! -f .setup-done ]; then
  echo "Setup hasn't finished yet. Run first: sh $BOT_DIR/scripts/host-setup.sh"
  exit 1
fi
rm -f .paused
if boot_running; then
  echo "Bot started. Check it with: tail -n 30 $BOT_DIR/bot-console.log"
  exit 0
fi
# setsid detaches the keep-alive loop from this terminal's session, so a web terminal that kills its
# command's process group (or closes) can't take the bot down with it.
if command -v setsid >/dev/null; then
  setsid nohup sh scripts/host-boot.sh >/dev/null 2>&1 </dev/null &
else
  nohup sh scripts/host-boot.sh >/dev/null 2>&1 </dev/null &
fi
sleep 5
echo "Bot started in the background. Check it with: tail -n 30 $BOT_DIR/bot-console.log"
