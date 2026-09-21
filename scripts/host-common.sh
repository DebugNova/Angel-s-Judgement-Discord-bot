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

# After a container reinstall the system packages are gone (the data folder survives): reinstall.
ensure_packages() {
  if find_pg_bin && command -v git >/dev/null && command -v node >/dev/null; then
    return 0
  fi
  say "Installing system packages"
  install_packages && find_pg_bin
}

# Options go before the user name: BusyBox su (Alpine) stops reading options at the user name.
as_postgres() { su -s /bin/sh -c "$*" postgres; }

pg_running() { pgrep -x postgres >/dev/null 2>&1; }

start_pg() {
  if pg_running; then
    return 0
  fi
  mkdir -p /run/postgresql
  chown postgres:postgres /run/postgresql
  chown -R postgres:postgres "$PGDATA"
  touch "$PGLOG" && chown postgres:postgres "$PGLOG"
  # No postgres process exists, so a leftover lock file is from an unclean stop. After a container
  # restart its PID may belong to an unrelated process, which would block startup; remove it.
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

bot_running() { pgrep -f "$BOT_CMD" >/dev/null 2>&1; }
