#!/bin/sh
# One-time setup for a Linux host (Alpine or Debian/Ubuntu), run as root from the project folder:
#   sh scripts/host-setup.sh
# Installs PostgreSQL, creates the database, writes the database lines of .env, then builds the bot.
# Safe to run again: it skips whatever is already done.
set -e
cd "$(dirname "$0")/.."
. scripts/host-pg.sh

echo "==> Installing PostgreSQL and OpenSSL"
if command -v apk >/dev/null; then
  apk add --no-cache openssl postgresql17 postgresql17-client ||
    apk add --no-cache openssl postgresql16 postgresql16-client ||
    apk add --no-cache openssl postgresql postgresql-client
else
  apt-get update && apt-get install -y openssl postgresql
fi
find_pg_bin

echo "==> Preparing the database"
mkdir -p "$PGDATA" /run/postgresql
chown -R postgres:postgres "$PGROOT" /run/postgresql
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  su postgres -s /bin/sh -c "$PG_BIN/initdb -D $PGDATA -E UTF8 --auth-local=trust --auth-host=scram-sha-256"
fi
start_pg

if [ ! -f .env ]; then
  echo "==> Creating the database user and .env"
  PASS=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  su postgres -s /bin/sh -c "$PG_BIN/psql -q -v ON_ERROR_STOP=1 -c \"CREATE USER satan WITH PASSWORD '$PASS';\" -c \"CREATE DATABASE satan OWNER satan;\""
  cp .env.example .env
  sed -i \
    -e "s|^EMBEDDED_DB=.*|EMBEDDED_DB=false|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://satan:$PASS@127.0.0.1:5432/satan|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    .env
else
  echo "==> .env already exists, leaving it alone"
fi

echo "==> Installing packages and building (takes a minute)"
npm ci
npm run build

echo ""
echo "Setup finished."
echo "Next: open .env, paste your DISCORD_TOKEN and BOT_OWNER_IDS, save, then run:"
echo "  sh scripts/host-start.sh"
