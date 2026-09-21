# CLAUDE.md — Angel's Judgement (Seven Angels 1v1 bot)

Discord bot for the **Seven Angels** clan: 1v1 challenges → private match rooms → report/confirm or dispute → referee → ELO, stats, leaderboards, history. Bot display name **Angel's Judgement** (formerly "Satan"; the folder, DB user and data dir still say `satan`/`SatanBot`. Leave them, renaming loses data).

The owner is not a developer. Explain changes in plain words and give them exact steps to test.

## Stack (versions are pinned on purpose. Don't upgrade casually.)
Node 20.11+ (dev machine runs 24) · TypeScript **5.9** strict, ESM (`"type": "module"`, imports end in `.js`) · discord.js **14** · Prisma **6.19** (not 7) · PostgreSQL 17 · vitest 3 · ESLint 9 + Prettier.

## Commands
| Command | Use |
| --- | --- |
| `npm run check` | typecheck + lint + all tests. **Run after every change.** |
| `npm test` | vitest; spins up a throw-away embedded PostgreSQL on port 54339 |
| `npm run smoke` | LIVE end-to-end test in the server from `DISCORD_GUILD_ID` (local bot must be stopped; restores the DB afterwards; needs two other bots in that server as stand-in players). Refuses the real token from `.env.production`: the PC is meant to run the TEST bot (`use-test-bot.bat`) in the test server. Run after changing anything in `src/discord/`. |
| `npm run build` / `npm start` / `start.bat` | build to `dist/` / run the bot |
| `npm run db:dev` | run the embedded DB in the foreground for `npx prisma migrate dev` / `studio` |
| `npm run db:backup` / `db:restore -- file --yes` | JSON backup/restore of every table |
| `npm run commands:deploy -- --validate` | ask Discord to validate command definitions |

## Layout
- `src/modules/*`: **business logic, no discord.js imports.** One service per area: challenges, matches, results (`finalize.ts` = the only way a match result becomes official), referee, elo, leaderboard, history, players, permissions, configuration, cooldowns, audit, reset, seasons.
- `src/discord/`: interface. `events.ts` routes interactions (permission gate, rate limit, error → friendly embed). `commands/` holds member/staff/admin slash commands. `components.ts` holds every button/select/modal handler. `actions/staff.ts` holds the shared referee flows. `flows.ts` holds the side effects after state changes. `managers/` covers channels (private rooms), panel (persistent + sticky status panel) and notify (history/staff/log/leaderboard channels). `jobs.ts` is the 20 s sweep + startup recovery. `ui/` holds `theme.ts`, `embeds.ts`, `components.ts`, and **`lore.ts` (all branding and story text)**. `ids.ts` defines the customId scheme.
- `src/database/`: Prisma client, embedded PostgreSQL bootstrap (`embedded.ts`), migrations runner, backup.
- `prisma/schema.prisma` + `prisma/migrations/`.
- `tests/`: `helpers.ts` (`startMatch`, `resetDb`, identities A/B/C/REF), plus service tests and `interactions.test.ts` (fake interactions driving `handleComponent`).
- `src/scripts/`: `smoke.ts`, `backup.ts`, `restore.ts`, `deploy-commands.ts`.

## Rules that must keep holding
1. A player is in at most one live match (`Player.currentMatchId`, set/cleared only in transactions under `lockPlayers` = `SELECT … FOR UPDATE`).
2. State changes are conditional updates (`updateMany where status = expected`); 0 rows → `Errors.stale()`.
3. `finalizeMatch` is the only place stats/ELO change for a match. It's atomic and idempotent. Never add a second path.
4. Every ELO change writes `EloHistory`. Every staff/admin action writes `AuditLog` (`audit()`, or `auditInTx` + `publishAudit` after commit).
5. Never trust customIds: handlers reload the entity and re-check the user + level + status.
6. User-facing failures throw `DomainError(code, message, title)`. Anything else is logged and shown as a generic error.
7. Staff can't act on their own matches (`assertImpartial`). Admin-role config is owner-only.
8. Private server links and evidence never leave the match channel.

## How to…
- **Add a slash command:** add it to the relevant array in `src/discord/commands/{member,staff,admin}.ts` (set `level`, and `cooldown` if spammy). Registration is automatic on bot start. Update `HELP_CATEGORIES` in `embeds.ts`, the README command table and TEST.md. The smoke test asserts the command count (`commands.length === 16`), so update it.
- **Add a button:** add an ID builder in `ids.ts` (customId ≤ 100 chars), a builder in `ui/components.ts`, and a handler branch in `components.ts` that re-validates. Add a case to `tests/interactions.test.ts`.
- **Change the schema:** edit `schema.prisma`, run `npm run db:dev` in one terminal, then `DATABASE_URL=postgresql://satan:satan-local@127.0.0.1:54321/satan npx prisma migrate dev --name <change>` (bot stopped). Migrations apply automatically on bot start. If you add a table, also add it to `src/database/backup.ts`, and to `resetDb` in `tests/helpers.ts`.
- **Change text/lore/branding:** `src/discord/ui/lore.ts` (and titles in `embeds.ts`).
- **Change defaults:** `GuildConfig` defaults in `schema.prisma` (needs a migration) or per server via `/config`.

## Gotchas
- The bot must run as **one instance**. Before `npm run smoke` or `db:restore`, make sure it's stopped (`smoke` refuses if it detects the bot's DB in use).
- The embedded DB lives in `%LOCALAPPDATA%\SatanBot\postgres` (never inside OneDrive). A force-closed run leaves a hung orphan that `embedded.ts` detects and replaces on the next start.
- Logs: console + `logs/bot-YYYY-MM-DD.log` (UTC, 30 days kept). Tests log at `error` level only.
- Owner-facing hosting/testing/update walkthrough: `docs/HOSTING-GUIDE.md` (keep it in sync when scripts or flows change).
- Production runs on a Shulker container (`node:20-alpine`, 512 MB, root) at `/data/bot` with its own PostgreSQL in `/data/postgres`, driven by `scripts/host-*.sh` (README §9). **No storage volume**: `/data` survives restarts but not "Reinstall container"; recovery is from the newest `#bot-backups` file. Shulker's startup option does not apply ("No startup configuration found"), so after a server restart the owner runs `host-start.sh` (it detaches with setsid). Shulker's web terminal quirks: lines starting with `cd` break, `sed -i` prints instead of editing (use `host-env.sh`), uploads must target a selected folder. `host-setup.sh` leaves the bot paused (`.paused`); `host-boot.sh` waits for `.setup-done`. The bot auto-backs up to `backups/auto/` and to `BACKUP_CHANNEL_ID`. Only one instance: stop the PC copy while Shulker runs.
- `.env` holds the real bot token. Never print it, commit it or send it anywhere except Discord.
- Git: commit each fix/feature with a clear message so it can be rolled back (`git log`, `git revert`).
- After any change: `npm run check` → (Discord layer changed?) `npm run smoke` → tell the user to restart `start.bat`.
