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

Please: find the root cause, fix it, add a test that reproduces it, run `npm run check`
(and `npm run smoke` if Discord-side code changed — stop the bot first), then tell me
exactly what changed and whether I need to restart the bot.
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
| What happened to a match | `/match view match_id:SA-…` (staff view) |
| Who did what | the `#bot-logs` channel, or `/player inspect` for one player |
| Is everything healthy? | `/botstatus` |

Every user-facing error is also logged with its technical details. The player only sees a friendly message.

## Self-checks you can run

```bash
npm run check      # type-check + lint + 59 automated tests (~30 s). Safe to run any time.
npm run smoke      # LIVE test in your server (stop the bot first!). Creates a private
                   # "🧪 aj-smoke-test" category, runs full matches, then deletes it and
                   # restores the database exactly as it was.
npm run smoke -- --keep   # same, but leaves the test channels so you can look at them
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
