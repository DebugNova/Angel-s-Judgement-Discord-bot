# Shared helpers for the host-*.sh scripts (sourced, not run directly).
PGROOT=/var/lib/postgresql
PGDATA=$PGROOT/data

# Finds the folder holding pg_ctl/initdb (Alpine keeps them outside PATH per version).
find_pg_bin() {
  for d in /usr/libexec/postgresql17 /usr/libexec/postgresql16 /usr/libexec/postgresql \
    /usr/lib/postgresql/*/bin /usr/bin; do
    if [ -x "$d/pg_ctl" ]; then
      PG_BIN=$d
      return 0
    fi
  done
  echo "PostgreSQL is not installed. Run: sh scripts/host-setup.sh" >&2
  exit 1
}

start_pg() {
  mkdir -p /run/postgresql
  chown postgres:postgres /run/postgresql
  if su postgres -s /bin/sh -c "$PG_BIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    return 0
  fi
  echo "==> Starting PostgreSQL"
  su postgres -s /bin/sh -c "$PG_BIN/pg_ctl -D $PGDATA -l $PGROOT/postgres.log -w start"
}
