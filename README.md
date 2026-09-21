# 😇 Angel's Judgement — Seven Angels 1v1 Bot

> *Before the throne of Judgement, the Seven Angels are weighed against one another. Every duel is a trial — the victor ascends, the defeated falls.*
>
> (All lore and branding text lives in [`src/discord/ui/lore.ts`](src/discord/ui/lore.ts). Edit that one file to change it.)

**Angel's Judgement** is the 1v1 matchmaking and ranking bot for the **Seven Angels** Discord server. It handles challenges, private match rooms, result reporting and confirmation, referee review of disputes, ELO, stats, leaderboards and match history.

- **Free to run:** a single Node.js process plus PostgreSQL. On a laptop the bot starts its own bundled PostgreSQL, so there is nothing else to install and no paid services.
- **Safe:** challenges, accepts, results and ELO updates all run inside database transactions with row locks. A match is finalized exactly once, so double clicks and simultaneous presses can't award ELO twice.
- **Restart-safe:** all state lives in PostgreSQL. After a crash or reboot the bot reloads active matches, recreates missing match channels, restarts challenge timers and cleans up.
- **Ready to grow:** the match model is team-based internally (1v1 = two one-player sides) and already has `seasonId`, `divisionId`, `teamId`, `tournamentId`, `round` and `bracketPosition` fields.

---

## Contents

1. [Quick start (Windows laptop)](#1-quick-start-windows-laptop)
2. [Discord Developer Portal setup](#2-discord-developer-portal-setup)
3. [Inviting the bot & permissions](#3-inviting-the-bot--permissions)
4. [First-time server setup](#4-first-time-server-setup)
5. [How a match works](#5-how-a-match-works)
6. [Commands](#6-commands)
7. [Environment variables](#7-environment-variables)
8. [Database, migrations & backups](#8-database-migrations--backups)
9. [Production deployment](#9-production-deployment)
10. [Development](#10-development)
11. [Troubleshooting](#11-troubleshooting)

**Hosting on Shulker, testing and updating, step by step:** [docs/HOSTING-GUIDE.md](docs/HOSTING-GUIDE.md)

More detail: [TEST.md](TEST.md) (step-by-step testing) · [docs/DEBUGGING.md](docs/DEBUGGING.md) (bugs & fixes) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ADMIN.md](docs/ADMIN.md)

---

## 1. Quick start (Windows laptop)

**Requirements:** [Node.js 20.11+ (LTS)](https://nodejs.org). Nothing else.

1. Fill in `.env` (copy `.env.example` → `.env` and set `DISCORD_TOKEN`).
2. Double-click **`start.bat`**, or run:

   ```bash
   npm install
   npm run build
   npm start
   ```

On first start the bot:

1. downloads nothing extra: PostgreSQL ships inside `node_modules`. It creates a database under `%LOCALAPPDATA%\SatanBot\postgres`, deliberately outside OneDrive, because sync tools can corrupt live databases.
2. applies database migrations,
3. logs in and registers its slash commands in every server it has joined (updates show up instantly).

Stop it with **Ctrl+C**, or by closing the window. The database shuts down cleanly with the bot.

> The bot only runs while this PC is on and `start.bat` is running. To keep it online 24/7, see [Production deployment](#9-production-deployment).

---

## 2. Discord Developer Portal setup

On <https://discord.com/developers/applications> → your application:

| Setting | Value |
| --- | --- |
| **Bot → Token** | Put it in `.env` as `DISCORD_TOKEN`. Never share it. |
| **Bot → Privileged Gateway Intents → Message Content Intent** | **ON.** Needed to record screenshots uploaded as evidence. |
| Server Members Intent / Presence Intent | Not needed |
| **Installation → Install Link** | Use the invite link below |

---

## 3. Inviting the bot & permissions

Invite link (bot + slash commands, only the permissions it needs):

```
https://discord.com/oauth2/authorize?client_id=1551652614566051931&permissions=268561488&scope=bot%20applications.commands
```

| Permission | Why |
| --- | --- |
| View Channels, Send Messages, Embed Links, Read Message History | Panels, embeds, history records |
| Manage Channels | Create and delete private match channels |
| Manage Roles | Write the permission overwrites that make match channels private, and lock them after a match |
| Manage Messages | Keep the match panel as the latest message |
| Attach Files, Add Reactions | Evidence uploads (the bot reacts 📎 to recorded evidence) |

Administrator is **not** required. If you've already given the bot Administrator, that works too.

---

## 4. First-time server setup

Run these as the server owner or an Administrator. Setup is also shown in `/help → Admin`.

**Step 1: create the channels** (suggested names):

| Channel | Purpose | Who can see it |
| --- | --- | --- |
| `⚔️ 1V1 DUELS` (a **category**) | Private match rooms get created here | Nobody needs to. The bot sets permissions per match. |
| `📜・match-history` | One public record per completed match | Everyone |
| `🏆・leaderboard` | Live top-10, edited in place | Everyone (read-only) |
| `🚨・referee-alerts` | Dispute notifications with a **Review Match** button | Staff |
| `📋・bot-logs` | Audit log of every important event | Staff |

**Step 2: point the bot at them**

```
/config channel matches   category:⚔️ 1V1 DUELS
/config channel history   channel:#match-history
/config channel leaderboard channel:#leaderboard
/config channel staff     channel:#referee-alerts
/config channel logs      channel:#bot-logs
```

**Step 3: choose staff roles.** A role picker opens; you can select several roles.

```
/config roles level:referee      → review disputes, decide results
/config roles level:moderator    → + cancel, force-complete, reopen, restrict players
/config roles level:admin        → + configuration and resets   (server owner only)
```

**Step 4: check everything:** `/config view`

The defaults: starting ELO 1000, K-factor 48 (1.5x the master spec's 32, for faster climbs), 60 s challenge timeout, 60 s pair cooldown, 5 matches to be ranked, and match channels deleted 10 minutes after the match ends. You can change all of them; see [docs/ADMIN.md](docs/ADMIN.md).

---

## 5. How a match works

```
/1v1 @Player  ──►  🟡 Challenge (Accept / Decline / Cancel, expires in 60 s)
                      │ Accept
                      ▼
              Match SA-000001 + private #queue-001
              (players + referee/mod/admin roles only)
                      │ share private server link, play
                      ▼
              Player presses 🏆 Report Result → "Who won?"
                      │
          ┌───────────┴───────────┐
   Opponent ✅ confirms      Opponent 🚨 disputes
          │                       │
          │               🔴 staff alerted → ⚖️ Review Match
          │               referee: Award Win / Request Evidence / Cancel
          ▼                       ▼
     🟢 COMPLETED — stats, streaks and ELO updated once, atomically
     history record posted · leaderboard refreshed · channel locked, then archived
```

- A **report alone never changes ELO**. Only the opponent's confirmation or a staff decision does.
- Screenshots uploaded in a match channel are recorded automatically as evidence (the bot reacts 📎).
- The **status panel** in each match channel is edited in place and re-posted to the bottom on state changes or during busy chat, so the controls are always easy to reach.
- Players can cancel only by **mutual agreement**. During a dispute only staff can cancel. Completed matches can never be cancelled or reopened.

---

## 6. Commands

**Members**

| Command | Description |
| --- | --- |
| `/1v1 @player` · `/challenge @player` | Challenge someone |
| `/stats [@player]` | Profile: ELO, rank, record, win rate, streaks, recent form |
| `/leaderboard [type] [size]` | Rankings by ELO, wins, win rate, streak or matches (paginated) |
| `/history [@player] [limit]` | Completed matches with ELO changes (paginated) |
| `/currentmatch` · `/match current` | Your match in progress |
| `/match view <id>` | View one of your matches |
| `/match cancel` | Request cancellation (your opponent must agree) |
| `/headtohead @player` | Head-to-head record |
| `/help` · `/about` · `/botstatus` | Help, lore, status |

**Staff.** Inside a match channel, `match_id` can be left out.

| Command | Level |
| --- | --- |
| `/match view` · `/match search` · `/match evidence` · `/match note` | Referee |
| `/match decide winner:@p [match_id]` | Referee: rules on a reported or disputed match |
| `/requestevidence [match_id]` | Referee |
| `/match cancel match_id:<id>` | Referee |
| `/match forcecomplete winner:@p [match_id]` · `/match reopen` | Moderator |
| `/player inspect` · `/player search` · `/player ban` · `/player unban` | Moderator |

**Admin**

| Command | Description |
| --- | --- |
| `/config view · channel · roles · elo · cooldown · challenge · matches · leaderboard · display · season` | Configuration |
| `/resetstats scope:(all/elo/streak/user)` · `/player reset @p` | Resets, with a typed confirmation `RESET SEVEN ANGELS` |
| `/maintenance enabled:true [message]` | Pause new challenges; ongoing matches continue |

Permission levels: **Owner** (server owner or `BOT_OWNER_IDS`) > **Admin** (Discord Administrator or admin role) > **Moderator** > **Referee** > **Member**. Staff can never act on a match they are playing in.

---

## 7. Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Bot token |
| `DISCORD_CLIENT_ID` | | Application ID. Derived from the token if empty. |
| `DISCORD_GUILD_ID` | | If set, commands register **only** in this server (for a test server) |
| `BOT_OWNER_IDS` | | Comma-separated user IDs with Owner level |
| `EMBEDDED_DB` | | `true` = bundled local PostgreSQL (default for laptops) · `false` = use `DATABASE_URL` |
| `EMBEDDED_DB_DIR` / `EMBEDDED_DB_PORT` | | Location and port of the bundled database (defaults: `%LOCALAPPDATA%\SatanBot\postgres`, `54321`) |
| `DATABASE_URL` | when `EMBEDDED_DB=false` | e.g. `postgresql://user:pass@host:5432/satan` |
| `NODE_ENV` | | `development` · `staging` · `production` |
| `LOG_LEVEL` | | `debug` · `info` · `warn` · `error` |
| `BACKUP_INTERVAL_MINUTES` | | Automatic backup check interval, default `60`; `0` = off |
| `BACKUP_KEEP` | | Automatic backups kept in `backups/auto/`, default `48` |
| `BACKUP_CHANNEL_ID` | | Private (owner-only) channel that receives every automatic backup |

`.env` is git-ignored and must never be committed.

---

## 8. Database, migrations & backups

- **Schema:** [`prisma/schema.prisma`](prisma/schema.prisma). Main models: GuildConfig, Player, Challenge, Match, MatchParticipant, MatchResult, EloHistory, Evidence, MatchNote, Season, Cooldown and AuditLog.
- **Migrations** run automatically on every start (`prisma migrate deploy`). You can also run `npm run db:migrate` by hand.
- **Backup:** `npm run db:backup` writes `backups/satan-<timestamp>.json.gz`, a full export of every table, and prints the row counts. It works with the bundled database and with any PostgreSQL.
- **Restore:** stop the bot, then run `npm run db:restore -- backups/<file>.json.gz --yes` (old plain `.json` backups work too). This **replaces** all current data. The data that was there is saved to `backups/before-restore/` first.
- **Automatic backups:** while running, the bot saves a backup to `backups/auto/` every `BACKUP_INTERVAL_MINUTES` (default 60) *when something changed*, keeping the newest `BACKUP_KEEP` (default 48). With `BACKUP_CHANNEL_ID` set, each one is also posted to that Discord channel, so a copy survives even if the host is wiped. **Make that channel visible to the owner only**, because backups contain private server links and evidence.
- On a VPS with Docker you can also use native tools: `docker compose exec postgres pg_dump -U satan satan > backup.sql`.
- **Supabase** (free tier) works as a remote database: set `EMBEDDED_DB=false` and `DATABASE_URL` to its connection string (use the *session* pooler or direct connection, port 5432).

Daily log files in `logs/` are deleted after 30 days.

---

## 9. Production deployment

The bot must run as **exactly one instance** per token.

**Docker (VPS, recommended)** — bot + PostgreSQL, restarts automatically:

```bash
cp .env.example .env        # set DISCORD_TOKEN, BOT_OWNER_IDS
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up -d --build
docker compose logs -f bot
```

**PM2 (VPS without Docker)**, with your own PostgreSQL or `EMBEDDED_DB=true`:

```bash
npm ci && npm run build
npm i -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

**Linux container host (e.g. Shulker, any `node:20-alpine` or Debian box, running as root)**: the bot runs next to its own PostgreSQL, both kept on a volume mounted at `/data`:

```sh
apk add git        # Debian/Ubuntu: apt-get install -y git
git clone https://github.com/DebugNova/Angel-s-Judgement-Discord-bot.git /data/bot
sh /data/bot/scripts/host-setup.sh          # installs PostgreSQL, builds, creates .env with DB settings
# fill in DISCORD_TOKEN, BOT_OWNER_IDS, BACKUP_CHANNEL_ID in /data/bot/.env
# set the host's startup script to /data/bot/scripts/host-boot.sh (or run host-start.sh)
```

| Script (`/data/bot/scripts/…`) | Does |
| --- | --- |
| `host-boot.sh` | Startup script: reinstalls system packages if missing, starts PostgreSQL, runs the bot and restarts it if it exits |
| `host-start.sh` / `host-stop.sh` | Start or resume / stop the bot (stays stopped until started) |
| `host-logs.sh` | Status of the bot and database plus the latest log lines |
| `host-update.sh` | Backup → `git pull` → build → restart |
| `host-restore.sh <file>` | Replace all data with a backup, then restart |

**Laptop, always on:** run `start.bat` at login (Task Scheduler → *At log on* → `start.bat`).

Environments: use a separate bot application and test server for development (`NODE_ENV=development`, `DISCORD_GUILD_ID=<test server>`). Don't test resets in production.

---

## 10. Development

```bash
npm run dev          # watch mode (tsx)
npm run check        # typecheck + lint + tests
npm test             # 59 unit, integration and simulated-button tests against a throw-away PostgreSQL
npm run smoke        # LIVE check in your real server (stop the bot first); cleans up after itself
npm run db:dev       # run the bundled PostgreSQL in the foreground (for prisma migrate dev / studio)
npm run commands:deploy              # register commands without starting the bot
npm run commands:deploy -- --validate  # dry-run the command definitions against Discord
```

Schema changes: start `npm run db:dev` and set `DATABASE_URL` to the printed URL. Then run `npx prisma migrate dev --name <change>` and commit the new folder in `prisma/migrations`.

The tests cover the challenge rules, cooldowns, expiry, accept and report races, confirmation, disputes, referee decisions, idempotent finalization, ELO math, permissions, cancel and reopen, leaderboard eligibility, resets and backup/restore.

---

## 11. Troubleshooting

| Problem | Fix |
| --- | --- |
| Commands don't appear | Restart the bot. It registers commands on startup and when it joins a server. Check the log for `COMMANDS_REGISTERED`. |
| "The match category has not been configured" | `/config channel matches` |
| "I am missing permissions in the match category" | Grant the listed permissions on the category, or re-invite with the link above |
| Evidence isn't recorded | Enable **Message Content Intent** in the Developer Portal |
| Referees don't see match channels | `/config roles referee`. New channels include the role; existing ones keep the permissions they were created with. |
| `EMBEDDED_DB_ORPHAN` warning on start | The previous run was force-closed. The bot recovers automatically. |
| "Another service is using port 54321" | Set `EMBEDDED_DB_PORT` to another free port |
| Bot replies "Something went wrong" | Check the console. Every failure is logged with details there (never shown to users). |
| Duplicate command responses | Two copies of the bot are running with the same token. Stop one. |

---

<sub>Angel's Judgement v1.0.0 · Built for Seven Angels · MIT License</sub>
