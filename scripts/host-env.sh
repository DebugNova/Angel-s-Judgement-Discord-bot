#!/bin/sh
# Sets one value in .env without printing secrets, or checks what is filled in.
#   sh /data/bot/scripts/host-env.sh BOT_OWNER_IDS 123456789012345678
#   sh /data/bot/scripts/host-env.sh check
. "$(dirname "$0")/host-common.sh"

if [ ! -f .env ]; then
  echo ".env does not exist yet. Run first: sh $BOT_DIR/scripts/host-setup.sh"
  exit 1
fi

show() {
  v=$(grep "^$1=" .env | tail -n 1 | cut -d= -f2-)
  if [ -z "$v" ]; then
    echo "  $1: EMPTY"
  elif [ "$2" = secret ]; then
    echo "  $1: set (${#v} characters, hidden)"
  else
    echo "  $1: $v"
  fi
}

if [ "$1" = check ] || [ -z "$1" ]; then
  echo "Settings in $BOT_DIR/.env:"
  show DISCORD_TOKEN secret
  show BOT_OWNER_IDS
  show BACKUP_CHANNEL_ID
  show DISCORD_GUILD_ID
  show EMBEDDED_DB
  show DATABASE_URL secret
  exit 0
fi

KEY=$1
VALUE=$2
case "$KEY" in
DISCORD_TOKEN | DISCORD_CLIENT_ID | DISCORD_GUILD_ID | BOT_OWNER_IDS | BACKUP_CHANNEL_ID | \
  BACKUP_INTERVAL_MINUTES | BACKUP_KEEP | LOG_LEVEL | FFMPEG_PATH | YTDLP_PATH | TOOLS_DIR) ;;
*)
  echo "Unknown setting: $KEY"
  exit 1
  ;;
esac
case "$VALUE" in
*[[:space:]]* | *\"* | *\'*)
  echo "The value must not contain spaces or quotes. Check what you pasted."
  exit 1
  ;;
esac

# Rewrite through a temp file (no sed -i), keeping .env's permissions: replace every KEY= line, or
# append one if it is missing.
TMP=$(mktemp)
awk -v k="$KEY" -v v="$VALUE" '
  index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
  { print }
  END { if (!done) print k "=" v }
' .env >"$TMP" && cat "$TMP" >.env
rm -f "$TMP"

if [ "$KEY" = DISCORD_TOKEN ]; then
  show "$KEY" secret
  rm -f ~/.ash_history ~/.bash_history 2>/dev/null
else
  show "$KEY"
fi
echo "Saved."
