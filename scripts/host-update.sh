#!/bin/sh
# Installs the newest version from GitHub: backup -> download -> build -> restart.
#   sh /data/bot/scripts/host-update.sh
set -e
. "$(dirname "$0")/host-common.sh"

ensure_packages
start_pg
sh scripts/host-stop.sh
trap 'echo ""; echo "Update FAILED. The bot is stopped. Send a screenshot of the messages above."' EXIT

say "Backing up before the update"
npm run db:backup -- backups/before-update

say "Downloading the newest version"
git pull --ff-only

say "Installing packages and building"
npm ci --no-audit --no-fund
npm run build

trap - EXIT
sh scripts/host-start.sh
echo "Update finished."
