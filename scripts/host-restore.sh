#!/bin/sh
# Replaces ALL bot data with a backup file, then restarts the bot.
#   sh /data/bot/scripts/host-restore.sh backups/satan-2026-....json.gz
# The data that was there before is saved to backups/before-restore/ first.
set -e
. "$(dirname "$0")/host-common.sh"

if [ -z "$1" ]; then
  echo "Tell me which backup to restore, for example:"
  echo "  sh $BOT_DIR/scripts/host-restore.sh backups/satan-2026-01-01T00-00-00-000Z.json.gz"
  echo ""
  echo "Backups on this server (newest last):"
  ls -1 backups/*.json* backups/auto/*.json* 2>/dev/null | tail -n 10
  exit 1
fi
case "$1" in
/*) FILE=$1 ;;
*) FILE=$BOT_DIR/$1 ;;
esac
[ -f "$FILE" ] || {
  echo "File not found: $FILE"
  exit 1
}

ensure_packages
start_pg
sh scripts/host-stop.sh
trap 'echo ""; echo "Restore FAILED. The bot is stopped and nothing was changed. Send a screenshot."' EXIT
npm run db:restore -- "$FILE" --yes
trap - EXIT
sh scripts/host-start.sh
echo "Restore finished."
