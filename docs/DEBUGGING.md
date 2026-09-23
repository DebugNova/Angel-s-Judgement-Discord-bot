# Debugging, fixing & changing the bot with Claude

## The prompt to paste into a new Claude Code conversation

Open Claude Code **in this folder** (`Desktop\Satan`), then paste one of these and fill in the brackets.

### 🐞 Bug / glitch

```
Read CLAUDE.md first.

BUG in Angel's Judgement.
What I did: [exact steps, e.g. "A ran /1v1 @B, B pressed Accept"]
What I expected: [...]
What happened instead: [error message / screenshot description]
When: [date + time]   Match ID (if any): [SA-000012]
Relevant log lines: see logs\bot-[YYYY-MM-DD].log around [time]   (or paste them here)

Where: [the live bot on Shulker / the test bot in AJ Test]

Please: find the root cause, fix it, add a test that reproduces it, run `npm run check`
(and `npm run smoke` with the TEST bot if Discord-side code changed — stop the bot first),
then tell me exactly what changed and how to get it live (HOSTING-GUIDE section 6).
```

### ✨ New feature / change

```
Read CLAUDE.md first.

CHANGE REQUEST for Angel's Judgement: [describe what you want, e.g. "add a /rank command that shows only my rank", or "change the lore to ...", or "remove the /headtohead command"]

Keep the existing architecture (services in src/modules, Discord code in src/discord).
Add or update tests, run `npm run check` (and `npm run smoke` if Discord-side code changed),
update README/TEST.md/docs if commands or behaviour changed, commit the change, and tell me
how to test it.
```

### 🔎 "Something feels off" check-up

```
Read CLAUDE.md first. Look through logs\ for the last few days for ERROR/WARN lines,
explain what each means in plain words, and fix anything that is a real bug.
```

## Gathering evidence for a bug

| What | Where |
| --- | --- |
| Full log of every run | `logs\bot-YYYY-MM-DD.log` (UTC dates). Search for `ERROR` and `WARN`. |
| The live bot on Shulker | `sh /data/bot/scripts/host-logs.sh` in the Shulker terminal (screenshot it; never the token) |
| A moderation action | the mod-log channel, or `/warnings @member` for one member's cases |
| What happened to a match | `/match view match_id:SA-…` (staff view) |
| Who did what | the `#bot-logs` channel, or `/player inspect` for one player |
| Is everything healthy? | `/botstatus` |

Every user-facing error is also logged with its technical details. The player only sees a friendly message.

## Self-checks you can run

```bash
npm run check      # type-check + lint + 111 automated tests. Safe to run any time.
npm run smoke      # 27-step LIVE test in AJ Test with the TEST bot (stop the bot first!).
                   # Creates a private "🧪 aj-smoke-test" category, runs full matches,
                   # moderation and music, then deletes it and restores the database
                   # exactly as it was. Refuses to run with the real bot's token.
npm run smoke -- --keep   # same, but leaves the test channels so you can look at them
npm run rehearse -- backups/<newest #bot-backups file>   # before an update that changes
                   # the database: proves every row survives the update
```

## Common problems

| Symptom | Cause / fix |
| --- | --- |
| Commands missing in Discord | Bot not running, or just started. Check the window for `COMMANDS_REGISTERED`. |
| Every action answers "Something went wrong" | Database or code error. Look in `logs\` for `ERROR`. |
| Bot responds twice | Two copies are running (for example `start.bat` opened twice). Close one. |
| "Arena not ready / missing permissions" | `/config channel matches` again, or fix the bot's permissions on the category. |
| `EMBEDDED_DB_ORPHAN` at startup | The last run was force-closed. The bot repairs this automatically. |
| Buttons on an old message say "no longer available" | Expected: the match already moved on. |
| A moderation confirm button says "expired" | Expected: confirm buttons last 2 minutes (and are forgotten on restart). Run the command again. |
| "Moderation is reserved for @z" for the owner | Expected: only the moderation role may moderate. `/config roles level:moderation` to change it. |
| No moderation card in the mod-log | `/config channel modlog`, and check the bot can post there. The log shows `MOD_LOG_FAILED`. |
| `/role everyone` says Discord won't give the member list | Turn on **Server Members Intent** for this bot in the Developer Portal. |
| Music: "ffmpeg is not installed" | Windows: `winget install Gyan.FFmpeg` and restart. Shulker: `host-update.sh` installs it. |
| Music: songs won't play, `YOUTUBE_BLOCKED` / `YTDLP_FAILED` in the log | YouTube is blocking the host for a while. The bot updates yt-dlp daily; wait a few hours. |
| Music stops mid-song | Look for `MUSIC_FFMPEG_EXIT`, `MUSIC_DOWNLOAD_FAILED` or `MUSIC_VOICE_ERROR` in the log. A failed song is retried once, then skipped. |
| Music didn't come back after a restart | Only sessions less than 2 hours old are resumed (`MUSIC_RESUMED` / `MUSIC_RESUME_FAILED` in the log). |
