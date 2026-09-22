# Shared helpers for the host-*.sh scripts (sourced, never run directly).
#
# Layout (the folder that holds the bot is the "data folder", e.g. a volume mounted at /data):
#   /data/bot        this project: code, .env, backups/, logs/
#   /data/postgres   the PostgreSQL database files
#   /data/postgres.log

BOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
DATA_DIR=$(dirname "$BOT_DIR")
PGDATA=$DATA_DIR/postgres
PGLOG=$DATA_DIR/postgres.log
BOT_CMD="node dist/index.js"
cd "$BOT_DIR" || exit 1

say() { echo "==> $*"; }

install_packages() {
  if command -v apk >/dev/null; then
    apk add --no-cache git openssl postgresql17 postgresql17-client 2>/dev/null ||
      apk add --no-cache git openssl postgresql16 postgresql16-client 2>/dev/null ||
      apk add --no-cache git openssl postgresql postgresql-client
  else
    apt-get update && apt-get install -y git openssl postgresql
  fi
}

# Sets PG_BIN to the folder with pg_ctl/initdb/psql (Alpine keeps them outside PATH per version).
find_pg_bin() {
  for d in /usr/libexec/postgresql17 /usr/libexec/postgresql16 /usr/libexec/postgresql \
    /usr/lib/postgresql/*/bin /usr/bin; do
    if [ -x "$d/pg_ctl" ] && [ -x "$d/initdb" ]; then
      PG_BIN=$d
      return 0
    fi
  done
  return 1
}

# Music needs ffmpeg. It is optional on purpose: if it can't be installed, the bot still starts
# (only music is unavailable), so this can never block the ranking bot.
ensure_ffmpeg() {
  command -v ffmpeg >/dev/null && return 0
  say "Installing ffmpeg (for music)"
  if command -v apk >/dev/null; then
    apk add --no-cache ffmpeg >/dev/null 2>&1
  else
    apt-get install -y ffmpeg >/dev/null 2>&1
  fi
  command -v ffmpeg >/dev/null || say "ffmpeg could not be installed. Music will be unavailable; everything else works."
  return 0
}

# After a container reinstall the system packages are gone (the data folder survives): reinstall.
ensure_packages() {
  if find_pg_bin && command -v git >/dev/null && command -v node >/dev/null; then
    ensure_ffmpeg
    return 0
  fi
  say "Installing system packages"
  install_packages && find_pg_bin && ensure_ffmpeg
}

# Options go before the user name: BusyBox su (Alpine) stops reading options at the user name.
as_postgres() { su -s /bin/sh -c "$*" postgres; }

# Process checks read /proc directly: pgrep/pkill are missing or behave differently across Linux
# images (on Shulker's Alpine image they did not see the running database).

# True if the PostgreSQL server that owns $PGDATA is running: the PID in its lock file must be alive
# and actually be a postgres process (after a restart an old PID can belong to something else).
pg_running() {
  pid=$(head -n 1 "$PGDATA/postmaster.pid" 2>/dev/null)
  [ -n "$pid" ] && [ -r "/proc/$pid/comm" ] && [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = postgres ]
}

start_pg() {
  if pg_running; then
    return 0
  fi
  mkdir -p /run/postgresql
  chown postgres:postgres /run/postgresql
  chown -R postgres:postgres "$PGDATA"
  touch "$PGLOG" && chown postgres:postgres "$PGLOG"
  # pg_running said no, so a leftover lock file is from an unclean stop (its PID is dead or now
  # belongs to an unrelated process, which would block startup): remove it.
  rm -f "$PGDATA/postmaster.pid"
  say "Starting PostgreSQL"
  as_postgres "'$PG_BIN/pg_ctl' -D '$PGDATA' -l '$PGLOG' -w -t 120 start"
}

stop_pg() {
  if pg_running; then
    say "Stopping PostgreSQL"
    as_postgres "'$PG_BIN/pg_ctl' -D '$PGDATA' -m fast -w -t 60 stop"
  fi
}

# True if the keep-alive loop (host-boot.sh) is running. Checks the command line, not just the PID,
# because after a restart an old PID can belong to a different process.
boot_running() {
  [ -f .boot.pid ] || return 1
  pid=$(cat .boot.pid)
  [ -n "$pid" ] && [ "$pid" != "$$" ] && [ -r "/proc/$pid/cmdline" ] &&
    grep -q host-boot "/proc/$pid/cmdline" 2>/dev/null
}

# PIDs of running bot processes: "node dist/index.js" started inside this bot folder. Checking the
# working folder too means other Node programs that happen to use dist/index.js are never touched.
bot_pids() {
  for f in /proc/[0-9]*/cmdline; do
    grep -q 'dist/index\.js' "$f" 2>/dev/null || continue
    grep -q node "$f" 2>/dev/null || continue
    d=${f%/cmdline}
    [ "$(readlink "$d/cwd" 2>/dev/null)" = "$BOT_DIR" ] || continue
    echo "${d#/proc/}"
  done
}

bot_running() { [ -n "$(bot_pids)" ]; }

# Sends a signal (TERM by default) to every bot process.
signal_bot() {
  for pid in $(bot_pids); do
    kill "-${1:-TERM}" "$pid" 2>/dev/null
  done
}
