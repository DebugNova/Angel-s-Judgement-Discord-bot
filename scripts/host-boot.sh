#!/bin/sh
# Keeps the bot running: starts PostgreSQL, then runs the bot and restarts it if it ever exits.
# Set this file as the host's startup script so everything comes back after a server restart.
# (host-start.sh also launches it in the background when there is no startup script.)
. "$(dirname "$0")/host-common.sh"
CONSOLE_LOG=$BOT_DIR/bot-console.log
# Keeps this file small: the full logs are in logs/bot-YYYY-MM-DD.log (the bot deletes old ones).
rotate_console_log() {
  if [ -f "$CONSOLE_LOG" ] && [ "$(wc -c <"$CONSOLE_LOG")" -gt 5000000 ]; then
    mv -f "$CONSOLE_LOG" "$CONSOLE_LOG.old"
  fi
}
rotate_console_log
exec >>"$CONSOLE_LOG" 2>&1

if boot_running; then
  echo "$(date -u '+%F %T') host-boot.sh is already running (pid $(cat .boot.pid)); not starting a second copy."
  exit 0
fi
echo $$ >.boot.pid
echo "$(date -u '+%F %T') ===== starting ====="

NODE_PID=
shutdown() {
  echo "$(date -u '+%F %T') shutting down"
  if [ -n "$NODE_PID" ]; then
    kill -TERM "$NODE_PID" 2>/dev/null
    wait "$NODE_PID" 2>/dev/null
  fi
  stop_pg
  rm -f .boot.pid
  exit 0
}
trap shutdown TERM INT HUP

# Until host-setup.sh has finished, only wait: the startup script may be switched on before setup.
if [ ! -f .setup-done ]; then
  echo "Waiting for setup to finish (run: sh $BOT_DIR/scripts/host-setup.sh)"
  until [ -f .setup-done ]; do sleep 5; done
fi

until ensure_packages; do
  echo "Installing system packages failed; retrying in 30 seconds"
  sleep 30
done
until start_pg; do
  echo "PostgreSQL did not start (see $PGLOG); retrying in 15 seconds"
  sleep 15
done

while true; do
  if [ -f .paused ]; then
    sleep 2
    continue
  fi
  rotate_console_log
  # Only warnings, errors and crashes land here (stderr); everything is in logs/ anyway.
  $BOT_CMD >/dev/null 2>>"$CONSOLE_LOG" &
  NODE_PID=$!
  wait "$NODE_PID"
  code=$?
  NODE_PID=
  [ -f .paused ] && continue
  echo "$(date -u '+%F %T') bot exited (code $code); restarting in 10 seconds"
  sleep 10
done
