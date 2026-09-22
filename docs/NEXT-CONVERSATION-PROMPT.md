# Prompt for the moderation + music conversation

Copy everything between the lines below and paste it as the first message of a new conversation.

---

I want to add two big features to my Discord bot "Angel's Judgement": (1) a full moderation system and (2) a full music system. Before you write ANY code, read CLAUDE.md, docs/HOSTING-GUIDE.md and README.md so you know the project, the hosting setup and the rules.

## About me and the current situation

- I'm NOT a developer. Explain everything in plain words, give me exact click-by-click steps, and never assume I know a technical term.
- The real bot is LIVE on Shulker hosting with real clan data (players, ELO, matches). It must never be disturbed, broken or lose data.
- Backups go to my private Discord channel #bot-backups every hour automatically.
- I have NOT set up the test bot yet (HOSTING-GUIDE section 7).
- My server: Shulker container, node:20-alpine, 512 MB RAM, 1 vCPU, no storage volume. The bot lives in /data/bot with its own PostgreSQL in /data/postgres.
- My clan is "Seven Angels", a Roblox Gakuran clan. The bot's theme/lore is angelic ("Seven Angels. One Judgement.").

## WORK IN THIS ORDER. Don't skip ahead.

### PHASE 0 — Test bot setup (do this first, with me, step by step)

Walk me through HOSTING-GUIDE section 7: test server "AJ Test", the test bot application, the two dummy bots, .env.production and .env.test, and use-test-bot.bat. Confirm my PC is actually on the TEST bot before anything is ever run. Also tell me every Developer Portal switch (intents) and Discord permission the new features will need, for BOTH the test bot and the real bot, and when to turn them on.

### PHASE 1 — Plan and discuss with me (NO code yet)

Think it through properly, then explain the options in simple words with your recommendation, and WAIT for my approval.

Cover at least:

**A) Architecture and risk**

- Should moderation and music live inside the same bot as the 1v1 system, or run as a separate bot/process? Explain the trade-offs honestly: a crash or memory spike in music must never take down the ranking system, which is the important one.
- How we keep the existing 1v1 code untouched and isolated (no second ELO path, existing rules in CLAUDE.md keep holding).
- What happens to memory/CPU on a 512 MB / 1 vCPU server while music plays, and what we do if it's not enough (limits, or a different hosting option and what it would cost).

**B) Moderation — I want at least**

- /ban (with reason, delete-messages option, and unban), /kick, /timeout (with duration) and remove timeout, /purge (delete N messages, with filters like only-one-user, only-bots, only-attachments, contains-text).
- /role: give or take a role from one member, AND give a role to EVERYONE in the server (mass role). Warn me about Discord rate limits on mass roles, how long it takes, and how we show progress and make it safe (confirmation, dry-run, can it be stopped halfway).
- A warning system (warn, list warnings, remove warning) stored in the database, with case numbers.
- A mod-log channel where every action is posted, plus a reason, the moderator, the target and a case number. Reuse the bot's existing audit log and log-channel setup where it makes sense.
- Safety: the bot must refuse to act on people with an equal or higher role than the moderator (and than itself), never let someone moderate themselves or the owner, confirm destructive actions, and optionally DM the member what happened and why.
- Who can use what: reuse the bot's existing permission levels (Member / Referee / Moderator / Admin / Owner) instead of inventing a new system. Tell me your suggested mapping.
- Tell me if things like auto-moderation (spam, bad words, raid protection), slowmode, lock/unlock channel, or a "mute role" are worth adding, and your recommendation. Don't build them unless I say yes.

**C) Music — I want it smooth, professional and reliable**

What I asked for: the bot joins my voice channel and plays from a YouTube link, a Spotify track link, a Spotify album, a full Spotify playlist, or just a name I type (it searches and plays the best match). Great sound quality, no lag, no stuttering, a beautiful player UI with buttons, queue, skip, pause, loop, shuffle, volume, and everything a top music bot has.

Before building, tell me the truth about the hard parts:

- Spotify: bots cannot legally stream Spotify audio (DRM). Explain how Spotify links actually work in practice (read the track/album/playlist info, then play the audio from another source) and what that means for accuracy and speed.
- YouTube: explain how often it breaks for bots on server IPs, what the workarounds are, how risky/maintainable each is, and whether alternative sources are more reliable.
- Terms of service and legal risk in plain words: what could get my bot or my server in trouble, and what you recommend.
- Options for playing audio: doing it inside the bot with ffmpeg, or using an audio server like Lavalink (on the same Shulker box or elsewhere). Compare them for my 512 MB / 1 vCPU server: sound quality, stability, memory, CPU, how much maintenance each needs, and cost.
- What "good quality, no buffering" realistically means on my server, and what you'd do to get there (buffering/pre-loading the next track, bitrate, reconnects, handling the bot being dragged between channels, empty-channel auto-leave).

Then propose the full feature list, for example: play/search with a chooser when several results match, queue with pages, now-playing panel with working buttons, skip/back, pause/resume, stop, loop (track/queue), shuffle, remove a track, clear, move, jump, seek, volume, save/load a playlist, history, a DJ role so not everyone can skip, 24/7 stay-in-channel mode, and auto-resume after a bot restart. Tell me which of these are easy, which are risky, and what you'd leave out.

**D) UI/UX quality bar**

Everything must match the bot's existing style: the same embed colours, the angelic lore wording, clean layouts, buttons instead of typing where sensible, replies that only I/the user can see when appropriate, clear friendly error messages, and no ugly raw error text. Show me mock-ups (in text) of the main screens before building: the music player panel, the queue, a moderation confirmation, and a mod-log entry.

**E) The plan itself**

Give me a short, numbered plan with phases, what each phase delivers, roughly how long each takes, and what could go wrong. Ask me any questions you need answered before starting. Then WAIT for my approval.

### PHASE 2 — Build moderation first (one feature at a time)

- Follow every rule in CLAUDE.md (business logic separate from the Discord layer, additive database migrations only, every staff action written to the audit log, permission re-checks on every button, friendly errors).
- Write automatic tests for everything new, and keep `npm run check` green.
- Run the live test (`npm run smoke`) with the TEST bot in AJ Test, and make sure it passes.
- Tell me exactly how to test it myself in AJ Test, step by step, including what to click and what I should see. I'll test on an alt account, never on real members.
- Fix whatever I report, then repeat until I'm happy.
- When I approve, push to GitHub and tell me the exact command to update Shulker, plus anything I must enable in Discord/the Developer Portal BEFORE I update.
- Update the docs: README command table, TEST.md, the /help categories, the smoke-test command count, and HOSTING-GUIDE if the process changes.

### PHASE 3 — Music, the same way

Same rules, same testing, same approval, one step at a time. Give me the performance numbers after it runs (memory and CPU while playing) and tell me honestly if my server is enough.

## Non-negotiable rules for the whole job

1. Never break or risk the existing 1v1 / ELO / match system. It's live with real data.
2. Never run anything with the REAL bot token on my PC. Test bot only. Verify before every test run.
3. My data must survive every update: additive migrations only, and a backup before each deploy.
4. I run the Shulker update command myself; you never touch the live server. Just tell me exactly what to paste.
5. Ask me before adding any new library, and tell me why it's needed, how well it's maintained, and its risks. Versions in this project are pinned on purpose.
6. Be honest about limits. If something I asked for is unreliable, illegal or too heavy for my server, tell me straight and offer the best realistic alternative instead of over-promising.
7. Commit each finished piece separately with a clear message so it can be rolled back.
8. Explain everything like I'm new to this, and always tell me what to click, in order.

Start with PHASE 0 now: check whether my test bot is set up, and if not, walk me through it one step at a time.
