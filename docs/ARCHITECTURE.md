# Architecture

Angel's Judgement is a **modular monolith**: one Node.js (TypeScript) process and one PostgreSQL database. Discord is only the interface. The business rules live in services with no Discord dependency, so a future web dashboard or REST API can call the same code.

```
Discord users
     │  slash commands · buttons · menus · modals · messages
     ▼
src/discord/            ← interface layer (discord.js v14)
  events.ts             routing, permission gate, rate limits, error handling
  commands/             member · staff · admin slash commands
  components.ts         button / select / modal handlers (re-validate everything)
  actions/staff.ts      shared staff flows (review, decide, cancel, evidence)
  flows.ts              Discord side effects of state changes
  managers/             channels (private rooms), panel (sticky status), notify (history/staff/logs/leaderboard)
  jobs.ts               restart-safe scheduler + startup recovery
  backups.ts            automatic backups (backups/auto + private Discord channel)
  presence.ts           status rotating every 10 s, profile bio sync
  moderation/           moderation commands, actions, confirm buttons, role-for-everyone, mod-log
  music/                music commands, buttons, DJ rules, the voice player, restart resume
  ui/                   theme, embeds, components, lore (the visual identity)
     │
     ▼
src/modules/            ← business logic (no discord.js imports)
  challenges  matches  results(finalize)  referee  elo  leaderboard
  history  players  permissions  configuration  cooldowns  audit  reset  seasons
  moderation (cases, safety, durations, filters)   music (queue, resolver, spotify, tools, store)
     │  Prisma (parameterised queries, transactions, row locks)
     ▼
PostgreSQL              ← single source of truth

Outside programs (music only): yt-dlp (downloaded + updated daily by the bot) → ffmpeg (system package)
```

Moderation and music are **side features**: they never read or write matches, results or ELO, so a bug there can't touch the rankings.

## Data model

| Model | Purpose |
| --- | --- |
| `GuildConfig` | Every server-specific setting: channel and role IDs, ELO, cooldowns, limits, the match counter and the active season. Keyed by guild ID, so the bot can serve several servers. |
| `Player` | Per-guild competitor: ELO, highest ELO, W/L/D, matches, win rate, streaks, restriction, and `currentMatchId` (the "busy" lock). |
| `Challenge` | PENDING → ACCEPTED / DECLINED / CANCELLED / EXPIRED, with `pairKey` for duplicate detection and the message location for later edits. |
| `Match` | The match abstraction: `gameMode`, `status`, `resultStatus`, `resolutionMethod`, a readable `matchId` (SA-000124), channel and panel IDs, server link, timestamps for every transition, `cleanupAt`, and future fields `seasonId`, `divisionId`, `teamId`, `tournamentId`, `round`, `bracketPosition`. |
| `MatchParticipant` | Players by side (`team` 0/1) with outcome, so 2v2 to 5v5 needs no schema change. |
| `MatchResult` | Reported winner and reporter, confirmed winner and confirmer, and the report/confirm/dispute/finalize timestamps. |
| `EloHistory` | Every rating change (`MATCH`, `RESET`, `ADMIN`). Ratings are never silently overwritten. |
| `Evidence` | Attachment metadata (who, message, URL, file) recorded from match channels. |
| `MatchNote` | Internal staff notes. |
| `Season` | Season groundwork. Matches and ELO history record the active season. |
| `Cooldown` | Restart-safe pair and global cooldowns. |
| `AuditLog` | Who did what, to whom, on which match, with metadata. |
| `ModCase` | One numbered moderation case per action (warn, timeout, kick, ban, purge, role, slowmode, lock…): target, moderator, reason, duration, whether the DM arrived, and removal info for warnings. Numbered per server from `GuildConfig.modCaseCounter`. |
| `MusicSession` | What is playing in a server (voice channel, queue as JSON, position, paused, volume). Saved every 30 s so music resumes after a restart. |
| `MusicPlaylist` | A member's saved playlist (name + tracks as JSON), unique per member and name. |

`GuildConfig` also holds the moderation settings (`moderationRoleIds`, `modLogChannelId`, `modDmMembers`) and the music settings (`musicDjRoleIds`, `musicVolume`, `music247`).

Rank is **computed live** from current ELO and never stored. Order: ELO, then wins, then Discord ID. The leaderboard and `/stats` use the same ordering, so they always agree.

## Match state machine

```
Challenge: PENDING ──accept──► ACCEPTED        PENDING ──► DECLINED | CANCELLED | EXPIRED

Match:     ACCEPTED ──channel created──► ACTIVE
           ACTIVE ──report──► RESULT_PENDING ──confirm──► COMPLETED   (resultStatus CONFIRMED)
                                     └──dispute──► DISPUTED ──review──► UNDER_REVIEW ──decide──► COMPLETED (STAFF_DECIDED)
           ACTIVE ──both agree / staff──► CANCELLED
           ACTIVE ──forcecomplete (moderator)──► COMPLETED (FORCE_COMPLETE)
           RESULT_PENDING | DISPUTED | UNDER_REVIEW ──reopen──► ACTIVE
           CANCELLED ──reopen (players free)──► ACTIVE
           COMPLETED is final (never cancelled, never reopened)
           ACCEPTED ──channel creation failed──► CANCELLED (players released)
```

## Concurrency & correctness

- **Row locks:** challenge creation and acceptance run `SELECT … FOR UPDATE` on both players (in a fixed order, which avoids deadlocks) before checking "banned / busy / duplicate / cooldown". Two challenges or accepts involving the same player are therefore serialized.
- **Conditional state transitions:** every change is an `UPDATE … WHERE status = <expected>`. If it matches zero rows, another action got there first, and the caller gets "This action is no longer available".
- **Exactly-once finalization:** `finalizeMatch` flips the match to COMPLETED with a conditional update. In the same transaction it updates both players, writes both ELO history rows, participant outcomes and the result record, and releases the players. A second call finds nothing to update, so the ELO can't be applied twice. The tests fire 3–5 simultaneous accepts, confirms and decisions to prove this.
- **Transactional audit:** audit rows are written inside the transaction and only published (console + log channel) after it commits.

## Moderation

Each command runs the same steps (`src/discord/moderation/actions.ts`): check the moderation role (`requireModeration`, re-checked on every button press) → check the safety rules (`modules/moderation/safety.ts`: not yourself, the owner, the bot, or anyone at or above your top role or the bot's) → ask to confirm if destructive (in-memory token, 2 minutes) → act on Discord and DM the member if wanted (the DM goes first for kicks and bans, since the member can't be reached afterwards) → only then write the `ModCase` + `AuditLog` row (`recordCase`) → post the result in the channel and a card in the mod-log. `/role everyone` runs as a background job at about one member per second with a live progress card and a Stop button.

## Music

- One player per server (`src/discord/music/player.ts`). Songs are found by `modules/music/resolver.ts`: a name is searched on YouTube, a YouTube/SoundCloud link is read by yt-dlp, and a Spotify track/album/playlist is read from Spotify's public page (no keys) and each song matched on YouTube by title and length, preferring official uploads. Spotify audio itself is never streamed (DRM).
- Audio path: yt-dlp downloads the song into a 32 MB memory buffer (so it finishes in seconds and exits) → Discord voice. YouTube's audio is already Opus 48 kHz, so at volume 100 it is sent untouched (near-zero CPU); only a volume change, a seek or another format adds ffmpeg, which re-encodes at 160 kbps. A crashed helper only ends that song (retried once).
- YouTube often blocks the normal web client on server IPs, so yt-dlp uses the `web_embedded, web_safari, mweb` clients and downloads the file itself (direct stream links return 403). yt-dlp is updated daily.
- The player pauses when everyone leaves, leaves after 2 minutes alone or 3 minutes after the queue ends (unless 24/7), and saves its session every 30 s. On startup, sessions younger than 2 hours are resumed near where they stopped.
- Every music error is caught and logged (`MUSIC_*`, `YTDLP_*`); the rest of the bot keeps running.

## Restart safety

- Nothing important lives only in memory. Timers, panel debouncing and rate limits in memory are just conveniences.
- On startup the bot re-arms challenge timers, expires overdue challenges, and checks each live match channel. A missing channel is **recreated** and the players are pinged. Channels in the match category that have no match record are reported (`ORPHAN_DETECTED`), never deleted.
- A 20-second sweep backs up the timers. It expires challenges, deletes channels that are due for cleanup (deleting first, then marking, so it stays idempotent), and finishes opening any match stuck in ACCEPTED because of a crash.
- The bundled PostgreSQL detects an orphaned server left by a force-close and replaces it safely. Normal shutdown uses `pg_ctl stop -m fast`.

## Security model

- Nothing trusts a custom ID, username, role name or match ID. Every button, menu and modal reloads the match or challenge and checks both the user and the current state.
- Permission levels come from role **IDs** stored in `GuildConfig`. Admin-role configuration is owner-only. Staff can't act on their own matches.
- Moderation is gated by `GuildConfig.moderationRoleIds` alone (the clan's **z** role). Owner, Admin and staff levels don't grant it; only the owner can change which roles have it.
- Backups contain private server links and evidence, so the bot only posts them to a channel that is private (otherwise it logs `BACKUP_CHANNEL_NOT_PRIVATE` and skips).
- Users never see a stack trace. Domain errors show friendly embeds, and technical errors are logged in full on the console.
- Private server links and evidence are never posted outside the match channel.
- Anti-abuse: per-user command throttle, a `/1v1` cooldown, pair and global cooldowns after declines, one outgoing challenge per player, a cap on incoming challenges, and a limit on how many matches can run at once.
- All queries go through Prisma (parameterized). The only raw SQL is a parameterized `FOR UPDATE` lock.

## Extensibility plan

| Future feature | Where it plugs in |
| --- | --- |
| Team matches (2v2–5v5) | `MatchParticipant.team` already models sides. Add team formation to `challenges`, and make `finalize` loop over participants. |
| Divisions | `Match.divisionId`, plus a Division model and a filtered leaderboard query. |
| Seasons | `Season`, `Match.seasonId` and `EloHistory.seasonId` already exist. Add season-scoped rating tables or snapshots. |
| Tournaments / brackets | `Match.tournamentId`, `round` and `bracketPosition`, plus a Tournament model and a bracket service that creates matches. |
| Best-of-N | Add a series model that groups matches. `finalize` stays per game. |
| Achievements / badges / titles | Add a `PlayerBadge` model and award it in `afterFinalize`. |
| Web dashboard / REST API | Call the same `src/modules/*` services. They don't depend on Discord. |
| Reserved commands | `/team`, `/division`, `/tournament`, `/season` are intentionally left unregistered until built. |
