# Angel's Judgement: Complete Hosting Guide

How to run the bot 24/7 on Shulker, how to test changes safely, how to update it, and what to do when something goes wrong. Everything is step by step. Do the parts in order the first time.

---

## Contents

- [The big picture (read this first)](#the-big-picture-read-this-first)
- **First-time setup**
  - [Part 1: Make a private backup channel in Discord](#part-1-make-a-private-backup-channel-in-discord)
  - [Part 2: Download the bot and switch on auto-start](#part-2-download-the-bot-and-switch-on-auto-start)
  - [Part 3: Run the setup](#part-3-run-the-setup)
  - [Part 4: Put your token and settings in .env](#part-4-put-your-token-and-settings-in-env)
  - [Part 5: Move your data from your PC to Shulker](#part-5-move-your-data-from-your-pc-to-shulker)
  - [Part 6: Check that the bot runs](#part-6-check-that-the-bot-runs)
  - [Part 7: Final check in Discord](#part-7-final-check-in-discord)
  - [Part 8: Turn your PC into a safe test machine](#part-8-turn-your-pc-into-a-safe-test-machine)
- **Everyday life**
  - [Part 9: Changing the bot (test, then update Shulker)](#part-9-changing-the-bot-test-then-update-shulker)
  - [Part 10: Command cheat sheet](#part-10-command-cheat-sheet)
- **When things go wrong**
  - [Part 11: Emergencies and fixes](#part-11-emergencies-and-fixes)
- **Good to know**
  - [Part 12: Storage, will it fill up?](#part-12-storage-will-it-fill-up)
  - [Part 13: Backups, how your data is protected](#part-13-backups-how-your-data-is-protected)
  - [Part 14: The golden rules](#part-14-the-golden-rules)
  - [Part 15: Questions and answers](#part-15-questions-and-answers)

---

## The big picture (read this first)

There are **two bots** and **three places**:

| Place | What runs there | Its job |
| --- | --- | --- |
| **Shulker** | The **REAL** bot, "Angel's Judgement", in your clan server | Runs 24/7 for your members |
| **Your PC** | The **TEST** bot, "Angel's Judgement Test", in a private test server | Where you try changes before members see them |
| **GitHub** | The bot's code, no data and no tokens | How new versions travel from your PC to Shulker |

On Shulker, everything lives in one folder, **`/data`**: the bot in `/data/bot` and its database in `/data/postgres`.

Your data (players, ELO, matches) is kept in **three places**:

1. The database on Shulker.
2. Backup files on Shulker (one every hour, when something changed).
3. The same backup files posted in a **private Discord channel**. These survive even if Shulker disappears completely.

> **About storage volumes:** Shulker offers "volumes" for $0.50/month. You don't need one. Without a volume, your files survive normal restarts of the server but **not "Reinstall container"**. If that ever happens, you set up again from the newest Discord backup (Part 11 explains how), so the most you could lose is about one hour of changes.

The flow of a change looks like this:

```
 change the code          test it                  upload             go live
 on your PC        --->   with the TEST bot  --->  to GitHub   --->   Shulker downloads it
 (Claude does it)         in your test server      ("push")           (one command)
```

**The most important rule:** the REAL bot must only ever run in **one** place at a time. Part 14 explains why.

### How to use the Shulker terminal

Almost everything on Shulker is done by pasting a command into the terminal:

1. Open your server on shulker.in. The terminal is the black box at the bottom that says **Terminal**. If you don't see it, click the **>_** icon at the bottom of the left sidebar.
2. Click in the line that says **Type command...**
3. Paste the command with **Ctrl + V**.
4. Press **Enter**, or click the paper-plane button.
5. **Wait** until the command finishes and the `root@sevenangels` line comes back before pasting the next one.

Tip: every command in this guide is in a grey box. Copy the **whole** box, exactly as written.

> **Shulker's terminal quirk:** a line that starts with `cd` is treated specially, so `cd somewhere && command` does **not** work there. The commands in this guide avoid it. Don't add `cd` yourself.

---

# First-time setup

## Part 1: Make a private backup channel in Discord

The bot posts a backup file here every hour when something changes. These files save you if Shulker ever dies.

1. In your **clan** Discord server, right-click the channel list and choose **Create Channel**.
2. Type **Text**, name `bot-backups`.
3. Turn **Private Channel** ON, click **Next**, don't add anyone, and click **Create Channel**.
   > Backups contain private server links and match evidence, so only you should see this channel. As a safety net, the bot **refuses to post backups** in a channel that @everyone can see. Backups are then only saved on Shulker, and the log shows `BACKUP_CHANNEL_NOT_PRIVATE`.
4. Let the bot in: right-click **#bot-backups** → **Edit Channel** → **Permissions** → **Add members or roles** → pick **Angel's Judgement**. Tick **View Channel**, **Send Messages** and **Attach Files**, then **Save Changes**.
5. Copy the channel's ID:
   - Discord **User Settings** (gear next to your name) → **Advanced** → turn on **Developer Mode**.
   - Right-click **#bot-backups** → **Copy Channel ID**.
   - Paste it into Notepad. It's a long number like `1551234567890123456`. You need it in Part 4.

## Part 2: Download the bot and switch on auto-start

This part also checks something important: that Shulker **keeps your files when it restarts**. We check it now, while nothing important is on the server yet.

Paste each command into the **Shulker** terminal, one at a time, and wait for each one to finish.

**2.1: Install git** (the tool that downloads the bot from GitHub):
```
apk add git
```
It finishes with a line like `OK: ... MiB in ... packages`.

**2.2: Download the bot:**
```
mkdir -p /data && git clone https://github.com/DebugNova/Angel-s-Judgement-Discord-bot.git /data/bot
```
It ends with `Resolving deltas: 100%` or similar.

**2.3: Switch on auto-start.** This makes the bot start by itself whenever Shulker restarts your server.
1. Click the **gear icon** (Settings) in the left sidebar and scroll to **STARTUP**.
2. Select the option **Startup script** (its grey text says "Execute a script file on start").
3. A **SCRIPT PATH** box appears with `/startup.sh` in it. Delete that and type exactly:
   ```
   /data/bot/scripts/host-boot.sh
   ```
4. Click **Save**, then **Apply & restart**.
5. Wait until the bottom-left corner shows **Running** again (about 30 seconds).

**2.4: Check that the files survived the restart.** Open the terminal again. If it's disconnected, click **+ New** on the right of the terminal. Paste:
```
ls /data/bot/scripts/host-boot.sh
```
- ✅ It prints `/data/bot/scripts/host-boot.sh` → Shulker keeps your files. **Continue to Part 3.**
- ❌ It prints `No such file or directory` → Shulker wiped the server when it restarted. **Stop here and tell Claude.** Your data is still safe on your PC; nothing has been moved yet. You'd need the $0.50 volume, and Claude will adjust the steps.

> The auto-start script now waits quietly in the background until Part 3 is done. That's expected.

## Part 3: Run the setup

This installs the database, installs the bot's parts and builds it:
```
sh /data/bot/scripts/host-setup.sh
```
- This takes **2 to 5 minutes**. It may look stuck on "installing the bot's packages". That's normal. Don't close the tab.
- You'll see `Step 1 of 4` up to `Step 4 of 4`.
- It must end with **`Setup finished. The bot is not running yet.`**
- If it ends with red errors instead, **stop** and send Claude a screenshot.

## Part 4: Put your token and settings in .env

The `.env` file is the bot's private settings file. The setup already created it and filled in the database part. You add the Discord part.

1. In the Shulker file explorer (left side, first icon), click the **refresh** icon. Then open **data** → **bot** → **.env**.
2. On your PC, open the `.env` file in your bot folder with VS Code.
3. Copy these lines **from your PC file into the Shulker file**, replacing the empty ones:
   - `DISCORD_TOKEN=...` (the long token)
   - `BOT_OWNER_IDS=...`
   - `DISCORD_GUILD_ID=...` (only if it has a value on your PC)
4. Find `BACKUP_CHANNEL_ID=` in the Shulker file and paste the channel ID from Part 1 after the `=`.
   It should look like: `BACKUP_CHANNEL_ID=1551234567890123456`
5. **Don't change** the lines `EMBEDDED_DB=false` and `DATABASE_URL=postgresql://...`. They must stay exactly as the setup wrote them.
6. Save with **Ctrl + S**.

> **Can't see `.env` in the explorer?** Some file browsers hide files that start with a dot. Use these commands instead. Replace the CAPITAL words with your real values, keep the `|` characters, and run one command at a time:
> ```
> sed -i 's|^DISCORD_TOKEN=.*|DISCORD_TOKEN=YOUR_TOKEN_HERE|' /data/bot/.env
> ```
> ```
> sed -i 's|^BOT_OWNER_IDS=.*|BOT_OWNER_IDS=YOUR_DISCORD_USER_ID|' /data/bot/.env
> ```
> ```
> sed -i 's|^BACKUP_CHANNEL_ID=.*|BACKUP_CHANNEL_ID=YOUR_CHANNEL_ID|' /data/bot/.env
> ```
> To check (this shows everything **except** the token):
> ```
> grep -v TOKEN /data/bot/.env | grep -v '^#' | grep .
> ```
> Commands you type can be remembered by the terminal, and the first one above contains your token. When you're done, erase that memory:
> ```
> rm -f ~/.ash_history ~/.bash_history
> ```

## Part 5: Move your data from your PC to Shulker

Want to start with empty stats instead? Skip to the box at the end of this part.

**5.1: Take the final backup on your PC.**
1. If the bot is running on your PC, **close its black `start.bat` window**. From now on the real bot runs on Shulker, not your PC.
2. Open the bot folder in **VS Code**, and open the terminal: menu **Terminal → New Terminal**, or **Ctrl + `**.
3. Paste and press Enter:
   ```
   npm run build
   ```
4. Then paste and press Enter:
   ```
   npm run db:backup
   ```
5. It prints something like:
   ```
   ✓ Backup written to C:\Users\...\Satan\backups\satan-2026-09-22T10-00-00-000Z.json.gz
     guildConfig=1 player=4 season=0 challenge=1 match=0 ... auditLog=31
   ```
6. **Take a screenshot of this.** The numbers (`player=4`, `auditLog=31` and so on) prove in step 5.4 that nothing was lost.

**5.2: Make a folder for it on Shulker:**
```
mkdir -p /data/bot/backups
```

**5.3: Upload the backup file.**
1. In the Shulker file explorer, click **refresh**, then open **data** → **bot** → **backups**.
2. Click the **upload** icon (the arrow pointing up, at the top of the explorer).
3. Pick the `.json.gz` file from 5.1. On your PC it's in the **Satan → backups** folder.
4. Wait until it appears in the list.

**5.4: Load it and start the bot.** Replace `FILENAME` with the real file name, for example `satan-2026-09-22T10-00-00-000Z.json.gz`. Keep `backups/` in front:
```
sh /data/bot/scripts/host-restore.sh backups/FILENAME
```
- It prints **`✓ Restored`** and a line of numbers like `player=4 ... auditLog=31`.
- **Compare those numbers with your screenshot from 5.1.** If they match, every player, match and ELO point arrived safely.
- It ends with **`Restore finished.`** and **starts the bot**.

> Not sure of the exact file name? Run `sh /data/bot/scripts/host-restore.sh` with nothing after it. It lists the backups it can see.

> **Starting with empty stats instead?** Skip 5.1–5.4 and just run:
> ```
> sh /data/bot/scripts/host-start.sh
> ```

## Part 6: Check that the bot runs

Wait **1 minute**, then run:
```
sh /data/bot/scripts/host-logs.sh
```
You should see:
```
Bot: RUNNING
Database: RUNNING
```
and further down, a line containing **`BOT_READY`**.

Then prove that auto-start works: click **gear → Apply & restart** (or restart the server from the panel), wait 1–2 minutes, and run `host-logs.sh` again. It should show **RUNNING** again without you starting anything.

## Part 7: Final check in Discord

Go through this list:

- [ ] The bot shows as **online** in the member list.
- [ ] Its status changes every 10 seconds ("Watching over the Seven Angels", "Competing in ranked 1v1s", and so on).
- [ ] `/stats` shows your existing ELO and record, so the data moved correctly.
- [ ] `/leaderboard` shows the same players as before.
- [ ] Within about **2 minutes** of starting, a backup file appears in **#bot-backups**.
- [ ] **Close the Shulker browser tab, wait 2 minutes, and check the bot is still online.**

If all boxes are ticked: **🎉 your bot is hosted 24/7.**

## Part 8: Turn your PC into a safe test machine

Your PC's `.env` still has the **real** token. If you ever double-clicked `start.bat` now, the real bot would run twice (Shulker and PC) and clash. This part fixes that for good by giving your PC its own **test bot**.

**8.1: Save the real settings as a backup file** (used only in emergencies):
1. In VS Code's file list, right-click `.env` → **Copy**.
2. Right-click an empty spot in the file list → **Paste**. This makes `.env copy`.
3. Right-click `.env copy` → **Rename** → type `.env.production` and press Enter.

**8.2: Make a test server:**
1. In Discord, click the **+** at the bottom of your server list → **Create My Own** → **For me and my friends**.
2. Name it `AJ Test` and click **Create**.
3. Right-click the new server's icon → **Copy Server ID**. Paste it in Notepad.

**8.3: Make the test bot:**
1. Go to <https://discord.com/developers/applications> and click **New Application**.
2. Name it `Angel's Judgement Test`, tick the box and click **Create**.
3. On **General Information**, copy the **Application ID** into Notepad.
4. Click **Bot** in the left menu:
   - Click **Reset Token**, confirm, and **copy the token** into Notepad.
   - Scroll down and turn **Message Content Intent** ON, then **Save Changes**.
5. Invite it to your test server. Take this link, replace `TEST_APP_ID` with the Application ID from step 3, and open it in your browser:
   ```
   https://discord.com/oauth2/authorize?client_id=TEST_APP_ID&permissions=268561488&scope=bot%20applications.commands
   ```
   Pick **AJ Test** and click **Authorize**.

**8.4: Make the test settings file:**
1. In VS Code, copy and paste `.env` again (like 8.1), and rename the copy to `.env.test`.
2. Open `.env.test` and change **two** lines:
   - `DISCORD_TOKEN=` → the **test** bot's token from 8.3
   - `DISCORD_GUILD_ID=` → the **AJ Test** server ID from 8.2
   - If it has a `BACKUP_CHANNEL_ID=` value, delete the number so the line is just `BACKUP_CHANNEL_ID=`
3. Save with **Ctrl + S**.

**8.5: Add two "dummy" bots to the test server.** The live test (`npm run smoke`) needs two other bots in the server to act as pretend players. They never have to be switched on; they only need to be members.
1. At <https://discord.com/developers/applications> click **New Application**, name it `AJ Dummy 1`, and click **Create**. Copy its **Application ID**.
2. Open this link with `DUMMY_APP_ID` replaced by that ID, pick **AJ Test**, and click **Authorize**:
   ```
   https://discord.com/oauth2/authorize?client_id=DUMMY_APP_ID&permissions=0&scope=bot
   ```
3. Do the same again for `AJ Dummy 2`.
4. The test server's member list should now show **Angel's Judgement Test**, **AJ Dummy 1** and **AJ Dummy 2** (the dummies show as offline, which is fine).

**8.6: Switch the PC to the test bot.** In your bot folder, double-click **`use-test-bot.bat`**. It says *"This PC now uses the TEST bot"*.

**8.7: Check it works.** Make sure `start.bat` is closed, then in the VS Code terminal:
```
npm run smoke
```
Near the top it should say `Smoke test in "AJ Test" as Angel's Judgement Test...`, and it should end with **`🎉 ALL 17/17 smoke steps passed.`** It cleans up after itself.

Your PC is now safe:
- `start.bat` runs the **test** bot in **AJ Test**, and can't touch the real bot or your clan's data.
- If your PC ever does have the real settings, `start.bat` warns you and asks before starting.
- The live test (`npm run smoke`) **refuses** to run with the real token.

> The test bot on your PC has its own separate database. Anything you do in AJ Test is fake data and never reaches Shulker.

---

# Everyday life

## Part 9: Changing the bot (test, then update Shulker)

Follow this every time you (or Claude) change something.

### Step 1: Make the change on your PC
Tell Claude what you want changed. Claude edits the code and runs the automated tests (`npm run check`).

### Step 2: Run the live test in your test server
Make sure the test bot's `start.bat` window is **closed**, then in the VS Code terminal:
```
npm run smoke
```
It runs about 17 checks in **AJ Test** and should end with **`🎉 ALL 17/17 smoke steps passed.`** Claude usually does this step for you.

### Step 3: Try it yourself
1. Double-click **`start.bat`**. The **test** bot comes online in AJ Test.
2. Try the change. For duels you need two accounts: a friend, or a second Discord account, invited to AJ Test.
3. When you're done, close the `start.bat` window.

### Step 4: Upload the change to GitHub
Tell Claude **"push"**. Your code is now on GitHub, but the real bot hasn't changed yet.

### Step 5: Update the real bot on Shulker
Pick a quiet moment, because the bot is offline for about **2–4 minutes**. Matches in progress are **not** lost; they continue afterwards.

In the **Shulker** terminal:
```
sh /data/bot/scripts/host-update.sh
```
It does everything by itself, in order:
1. Stops the bot.
2. **Backs up all data** to `backups/before-update/`.
3. Downloads the new version from GitHub.
4. Installs and builds it.
5. Starts the bot again.

It ends with **`Update finished.`**

### Step 6: Check it
```
sh /data/bot/scripts/host-logs.sh
```
Look for **`Bot: RUNNING`** and a **`BOT_READY`** line. Then try `/stats` in your clan server.

### If the update goes wrong
| What you see | What it means | What to do |
| --- | --- | --- |
| `Update FAILED` | The bot is stopped. Your data is untouched. | Screenshot it and send it to Claude. To run the old version meanwhile: `sh /data/bot/scripts/host-start.sh` |
| The bot runs, but something is broken | The new version has a bug | Tell Claude. Claude undoes the change and pushes it; you run `host-update.sh` again. |
| Data looks wrong after the update | Very unlikely | Load the backup made just before the update (see Part 11, "Load an older backup"). |

## Part 10: Command cheat sheet

**On Shulker** (paste into the Shulker terminal):

| I want to… | Command |
| --- | --- |
| See if the bot is healthy, plus recent logs | `sh /data/bot/scripts/host-logs.sh` |
| Stop the bot | `sh /data/bot/scripts/host-stop.sh` |
| Start the bot | `sh /data/bot/scripts/host-start.sh` |
| Restart the bot | `sh /data/bot/scripts/host-stop.sh && sh /data/bot/scripts/host-start.sh` |
| Install the newest version from GitHub | `sh /data/bot/scripts/host-update.sh` |
| List backups on the server (newest first) | `ls -lt /data/bot/backups/auto` |
| Make a backup right now | `npm --prefix /data/bot run db:backup` |
| Load a backup (replaces all data) | `sh /data/bot/scripts/host-restore.sh backups/auto/FILENAME` |
| See how much space the bot uses | `du -sh /data/*` |

**On your PC** (double-click in the bot folder, or paste into the VS Code terminal):

| I want to… | Do this |
| --- | --- |
| Use the test bot on this PC (normal) | Double-click `use-test-bot.bat` |
| Run the test bot | Double-click `start.bat` |
| Run the automated tests | `npm run check` |
| Run the live test in AJ Test | `npm run smoke` |
| Emergency: run the REAL bot on this PC | Part 11, "Shulker is dead" |

---

# When things go wrong

## Part 11: Emergencies and fixes

### The bot is offline in Discord
1. In the Shulker terminal:
   ```
   sh /data/bot/scripts/host-logs.sh
   ```
2. Match what you see:
   - **`Bot: STOPPED`**: someone ran host-stop. Start it:
     ```
     sh /data/bot/scripts/host-start.sh
     ```
   - **`Bot: NOT RUNNING`** or **`Database: NOT RUNNING`**: start everything:
     ```
     sh /data/bot/scripts/host-start.sh
     ```
     Wait 1 minute and run host-logs again.
   - **It keeps crashing** (the log shows `bot exited ... restarting` again and again): screenshot the host-logs output and send it to Claude.
   - **The terminal doesn't respond at all**: Shulker itself is down. Check the panel shows **Running**. If it doesn't come back within a few hours, see "Shulker is dead" below.

### Shulker is dead (the server is gone or down for a long time)
Your data is safe in **#bot-backups**. Run the real bot from your PC until Shulker is back:

1. In Discord, open **#bot-backups** and **download the newest file** (the last message).
2. Move that file into your bot folder, inside **backups**.
3. Double-click **`use-real-bot.bat`** and press **Y**. Your PC now has the real settings.
4. In the VS Code terminal (replace FILENAME with the real name):
   ```
   npm run db:restore -- backups/FILENAME --yes
   ```
   It prints **`✓ Restored`**.
5. Double-click **`start.bat`**. It warns that this is the real bot. Press **Y**.
6. Keep that window open. The bot runs as long as your PC is on and awake.

**When Shulker works again**, move back. Be quick: when Shulker comes back, it starts the real bot **by itself**, so for a moment both copies run.
1. In the **Shulker** terminal, stop its bot first:
   ```
   sh /data/bot/scripts/host-stop.sh
   ```
2. **Close** the `start.bat` window on your PC.
3. In VS Code: `npm run db:backup`. This saves everything that happened while the PC was in charge.
4. Upload that new file to Shulker and load it (Part 5, steps 5.2 to 5.4). The restore starts the Shulker bot again.
5. Double-click **`use-test-bot.bat`** on your PC.

### The real bot is running in two places (a clash)
Signs: buttons say "interaction failed", or you get two replies to one command. This happens when the real bot runs on Shulker **and** your PC at the same time.

1. **Close `start.bat` on your PC immediately.**
2. Double-click `use-test-bot.bat`.
3. If people played matches during the clash, some of them may have been saved on your PC instead of Shulker. Tell Claude roughly when it happened, and Claude will help recover them.

### Load an older backup
Use this if data got messed up, for example a wrong reset.

1. List the backups:
   ```
   ls -lt /data/bot/backups/auto /data/bot/backups/before-update 2>/dev/null | head -20
   ```
   File names contain the date and time in UTC. India is 5:30 ahead of UTC.
2. Load the one you want (this replaces all current data):
   ```
   sh /data/bot/scripts/host-restore.sh backups/auto/FILENAME
   ```
3. Changed your mind? The data from just before you restored is saved automatically in `backups/before-restore/`. Load that one to undo.

You can also load a file downloaded from **#bot-backups**: upload it to `data/bot/backups` in the explorer and use `backups/FILENAME`.

### Shulker "reinstalled" my server (everything on Shulker is gone)
Without a volume, a reinstall erases the bot, its database and its settings on Shulker. Your data is still safe in **#bot-backups**. Rebuild in about 15 minutes:

1. In Discord, open **#bot-backups** and **download the newest file** (the last message).
2. On Shulker, redo **Part 2** (git, download, auto-start and the restart check), **Part 3** (setup) and **Part 4** (`.env` settings).
3. Do **Part 5, steps 5.2 to 5.4**, but upload the file you downloaded from Discord instead of making a new one on your PC.
4. Check with **Part 6** and **Part 7**.

The most you lose is whatever changed after that last backup (at most about one hour).

### I lost the `.env` file on Shulker
The database password is stored in it, so ask Claude before running setup again. Your data itself is still safe.

### I pasted a command and got an error
Don't guess. Screenshot the command and the error and send it to Claude. None of these scripts delete data when they fail.

---

# Good to know

## Part 12: Storage, will it fill up?

No. Measured sizes:

| What | Size | Grows over time? |
| --- | --- | --- |
| Bot code and packages | about 560 MB | No, stays the same after updates |
| Database | about 50 MB | Very slowly |
| One backup | **3 KB** today; roughly 3–5 MB even after 10,000 matches | — |
| Automatic backups kept | newest 48 | No, older ones are deleted automatically |
| Log files | a few MB | No, deleted after 30 days |

**Total: under 1 GB, and it stays about that size.** The "Disk 78%" in Shulker's panel is Shulker's whole shared machine, not your bot.

Check your own usage at any time:
```
du -sh /data/*
```

Memory: your server has 512 MB. The bot uses about 100–150 MB and the database about 30–50 MB, so there's plenty left.

## Part 13: Backups, how your data is protected

| Backup | When | Where | Kept |
| --- | --- | --- | --- |
| Automatic | Every hour, **only if something changed**, plus a few minutes after each start | `/data/bot/backups/auto/` **and** Discord **#bot-backups** | Newest 48 on Shulker; forever in Discord |
| Before update | Every time you run `host-update.sh` | `/data/bot/backups/before-update/` | Until you delete them |
| Before restore | Every time you load a backup | `/data/bot/backups/before-restore/` | Until you delete them |
| Manual | When you run `npm run db:backup` | `backups/` | Until you delete them |

**The most you can ever lose is about one hour of changes**, and only if Shulker's storage is destroyed completely. In every other case nothing is lost.

Backup files end in `.json.gz`. They're compressed, and only the restore command can read them.

Settings you can change in `/data/bot/.env` (restart the bot afterwards):
- `BACKUP_INTERVAL_MINUTES=60`: how often to check for changes. `0` turns automatic backups off, which is not recommended.
- `BACKUP_KEEP=48`: how many automatic backups to keep on Shulker.
- `BACKUP_CHANNEL_ID=`: the private channel that receives each backup.

## Part 14: The golden rules

1. **The REAL bot runs in ONE place only.** Normally that's Shulker. Your PC uses the test bot. Two copies of the real bot fight over every button, and matches get saved in two different databases.
2. **Test first, then update.** PC and test server first; `host-update.sh` on Shulker only after it works.
3. **Keep #bot-backups private.** The files contain private server links.
4. **Never share or screenshot your `.env` files or tokens.** If a token leaks, reset it in the Developer Portal right away and update the `.env` file(s).
5. **Never click "Reinstall container"** unless Claude tells you to. It erases everything on Shulker, and you'd have to rebuild from the Discord backup (Part 11).
6. **When unsure, run `host-logs.sh` and send Claude a screenshot** before trying fixes.

## Part 15: Questions and answers

**Do I need to keep the Shulker tab open?**
No. Once setup is finished, the bot runs on its own, even with your PC off.

**Does the bot restart itself if it crashes?**
Yes, within 10 seconds. If the whole server restarts, the auto-start from Part 2 brings everything back.

**Will members lose their matches during an update?**
No. The bot is offline for a few minutes, and matches in progress continue afterwards.

**Can I change settings like ELO without an update?**
Yes. Anything under `/config` in Discord changes instantly, with no update needed.

**What if GitHub is down during an update?**
`host-update.sh` fails at the download step with `Update FAILED`, and the bot stays stopped. Run `sh /data/bot/scripts/host-start.sh` to keep using the current version and try the update later.

**What is `/data/bot/bot-console.log`?**
A short log with start/stop messages and crashes. The full logs are in `/data/bot/logs/`, one file per day. `host-logs.sh` shows both.

**Can I edit files on Shulker directly?**
Only `.env`. Code changes go through your PC and GitHub. If you edit code on Shulker, the next `host-update.sh` may fail.

**Where do I find something in this guide again?**
It lives in your bot folder at `docs/HOSTING-GUIDE.md`, and on GitHub.
