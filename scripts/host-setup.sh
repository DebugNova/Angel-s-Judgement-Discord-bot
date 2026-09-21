#!/bin/sh
# One-time setup on a Linux host (Alpine or Debian/Ubuntu), as root:
#   sh /data/bot/scripts/host-setup.sh
# Installs PostgreSQL, builds the bot, creates the database and fills in the database part of .env.
# Safe to run again: it skips whatever is already done and never deletes data.
set -e
. "$(dirname "$0")/host-common.sh"

say "Step 1 of 4: installing system packages (git, openssl, PostgreSQL)"
install_packages
find_pg_bin || {
  echo "PostgreSQL did not install correctly. Send a screenshot of the messages above." >&2
  exit 1
}

# The database lives next to the bot folder, so the postgres user must be able to reach that folder.
if ! as_postgres "test -x '$DATA_DIR'"; then
  echo "The database can't be stored in $DATA_DIR. Put the bot in /data/bot instead." >&2
  exit 1
fi

say "Step 2 of 4: installing the bot's packages (1-3 minutes)"
npm ci --no-audit --no-fund

say "Step 3 of 4: building the bot"
npm run build

say "Step 4 of 4: preparing the database"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  as_postgres "'$PG_BIN/initdb' -D '$PGDATA' -E UTF8 --locale=C --auth-local=trust --auth-host=scram-sha-256"
  # Small-server tuning (the container has 512 MB of memory).
  cat >>"$PGDATA/postgresql.conf" <<'EOF'

# ---- Angel's Judgement: tuned for a small container ----
listen_addresses = '127.0.0.1'
max_connections = 20
shared_buffers = 32MB
work_mem = 2MB
maintenance_work_mem = 16MB
effective_cache_size = 128MB
EOF
fi
start_pg

if [ -f .env ]; then
  say ".env already exists, leaving it alone"
else
  PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  SQL=$(mktemp)
  cat >"$SQL" <<EOF
DO \$\$ BEGIN
  CREATE ROLE satan LOGIN PASSWORD '$PASS';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE satan LOGIN PASSWORD '$PASS';
END \$\$;
SELECT 'CREATE DATABASE satan OWNER satan' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'satan')\gexec
EOF
  chmod 644 "$SQL"
  as_postgres "'$PG_BIN/psql' -q -v ON_ERROR_STOP=1 -d postgres -f '$SQL'"
  rm -f "$SQL"
  cp .env.example .env
  sed -i \
    -e "s|^EMBEDDED_DB=.*|EMBEDDED_DB=false|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://satan:$PASS@127.0.0.1:5432/satan?connection_limit=5|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    .env
  chmod 600 .env
  say "Created .env with the database settings"
fi

echo ""
echo "Setup finished."
echo "Next: open $BOT_DIR/.env and fill in DISCORD_TOKEN, BOT_OWNER_IDS and BACKUP_CHANNEL_ID."
