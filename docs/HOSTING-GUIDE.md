# Angel's Judgement: Hosting Guide

Your bot runs 24/7 on **Shulker**. This guide tells you how to look after it, how to change it safely, and how to get everything back if something breaks.

**Golden rule:** the REAL bot must run in **one place only**, which is Shulker. Never start the real bot on your PC while Shulker is running it.

---

## Contents

1. [How it all fits together](#1-how-it-all-fits-together)
2. [Using the Shulker terminal](#2-using-the-shulker-terminal)
3. [Daily: is the bot OK?](#3-daily-is-the-bot-ok)
4. [Shulker restarted or crashed: start the bot again](#4-shulker-restarted-or-crashed-start-the-bot-again)
5. [Your backups: where they are and how big](#5-your-backups-where-they-are-and-how-big)
6. [Changing the bot: test, then publish](#6-changing-the-bot-test-then-publish)
7. [One-time: set up your PC as a test machine](#7-one-time-set-up-your-pc-as-a-test-machine)
8. [Disaster: Shulker lost everything, rebuild it](#8-disaster-shulker-lost-everything-rebuild-it)
9. [Disaster: Shulker is dead, run the bot from your PC](#9-disaster-shulker-is-dead-run-the-bot-from-your-pc)
10. [Undo a mistake: load an older backup](#10-undo-a-mistake-load-an-older-backup)
11. [All commands in one place](#11-all-commands-in-one-place)
12. [Rules and quick answers](#12-rules-and-quick-answers)

---

## 1. How it all fits together

| Where | What's there |
| --- | --- |
| **Shulker** | The **real** bot and its database. The bot lives in `/data/bot`, the database in `/data/postgres`. |
| **Discord #bot-backups** | A copy of your data, posted automatically every hour when something changed. **Your safety net.** |
| **GitHub** | The bot's code only (no data, no token). Shulker downloads new versions from here. |
| **Your PC** | Where changes are made and tested, using a separate **test** bot (section 7). |

How a change travels:
```
change code on PC  →  test with TEST bot  →  push to GitHub  →  Shulker downloads it (1 command)
```

---

## 2. Using the Shulker terminal

1. Open your server on shulker.in. The terminal is the black box at the bottom. If it's missing, click **>_** at the bottom-left.
2. Click **Type command...**, paste with **Ctrl + V**, and press **Enter**.
3. Wait for each command to finish before pasting the next.

**Shulker's terminal has three quirks. The commands in this guide already avoid them:**
- ❌ Don't start a line with `cd`. It breaks the line.
- ❌ Don't use `sed -i`. It prints your whole `.env` file, **token included**, instead of editing it. Use `host-env.sh` (section 8, step 5).
- 📁 To upload a file, **first click the folder you want it in**, then click the upload icon. Uploading to `/` fails.

---

## 3. Daily: is the bot OK?

The quickest check is Discord: the bot shows **online** and its status changes every 10 seconds.

For more detail, paste into Shulker:
```
sh /data/bot/scripts/host-logs.sh
```
A healthy bot shows:
```
Bot: RUNNING
Database: RUNNING
```
Lines with `ORPHAN_DETECTED` are harmless: they mean `#1v1-duels` and `#info` sit inside the match-room category. To silence them, drag those channels out of that category in Discord.

---

## 4. Shulker restarted or crashed: start the bot again

Shulker's **auto-start doesn't work** ("Apply & restart" says *No startup configuration found*, which is Shulker's bug). So after Shulker restarts your server, the bot stays **off** until you start it. Your data is **not** lost by a restart.

**When the bot is offline in Discord:**

1. Open the Shulker terminal and paste:
   ```
   sh /data/bot/scripts/host-logs.sh
   ```
2. If it says **NOT RUNNING** or **STOPPED**, paste:
   ```
   sh /data/bot/scripts/host-start.sh
   ```
3. Wait 1 minute and run `host-logs.sh` again. You want **Bot: RUNNING** and **Database: RUNNING**.

That's all. The start command starts the database too, and the bot keeps running after you close the browser.

- **If `host-logs.sh` says `No such file or directory`**, Shulker wiped your server. Go to **section 8**.
- **If the terminal doesn't open at all**, Shulker itself is down. Wait a few hours. If it's still down, see **section 9**.
- **If the bot keeps crashing** (`bot exited ... restarting` over and over), screenshot `host-logs.sh` and send it to Claude.

---

## 5. Your backups: where they are and how big

**The bot makes backups by itself.** About 2 minutes after it starts, and then **every hour if anything changed**, it saves one to **both** of these places:

| Where | Kept for | Survives Shulker being wiped? |
| --- | --- | --- |
| Shulker: `/data/bot/backups/auto/` | Newest 48 (older ones are deleted automatically) | ❌ No |
| Discord: **#bot-backups** | Forever | ✅ **Yes** |

It also saves one automatically **before every update** (`backups/before-update/`) and **before every restore** (`backups/before-restore/`), so you can always undo.

**The most you can ever lose is about 1 hour of changes**, and only if Shulker is wiped completely.

**Space used:**

| What | Size |
| --- | --- |
| One backup | about **3 KB** now; even after 10,000 matches only 3–5 MB |
| Bot program and its parts | about 560 MB (doesn't grow) |
| Database | about 50 MB (grows very slowly) |
| Logs | a few MB (deleted after 30 days) |
| **Total** | **under 1 GB, and it stays that way** |

To see it yourself on Shulker:
```
du -sh /data/*
```

To see your backups on Shulker (newest first):
```
ls -lt /data/bot/backups/auto
```

**Keep #bot-backups private.** The files contain private server links. If that channel is ever made public, the bot stops posting there (the log then says `BACKUP_CHANNEL_NOT_PRIVATE`).

---

## 6. Changing the bot: test, then publish

Do **section 7 once** first, so your PC has its own test bot.

### Step 1: Ask Claude for the change
Claude edits the code and runs the automatic tests (`npm run check`).

### Step 2: Test it with the test bot
1. In your bot folder, double-click **`use-test-bot.bat`** (makes sure your PC uses the test bot).
2. Double-click **`start.bat`**. The **test** bot comes online in your **AJ Test** server.
3. Try the new feature there. For duels you need a second account or a friend in AJ Test.
4. Close the `start.bat` window when you're done.

Claude can also run the full live test: `npm run smoke`, which should end with `ALL 17/17 smoke steps passed`.

### Step 3: Publish to GitHub
Tell Claude **"push"**. Nothing changes for your members yet.

### Step 4: Update the real bot on Shulker
Pick a quiet time. The bot is offline for **2–4 minutes**. Matches in progress are **not** lost; they continue afterwards.

Paste into Shulker:
```
sh /data/bot/scripts/host-update.sh
```
This does everything in order: stop the bot, **back up the data**, download the new version, build it, and start it again. It ends with **`Update finished.`**

### Step 5: Check it
```
sh /data/bot/scripts/host-logs.sh
```
You want **Bot: RUNNING**. Try `/stats` in Discord.

### If something goes wrong
| You see | Do this |
| --- | --- |
| `Update FAILED` | Your data is untouched. Start the old version with `sh /data/bot/scripts/host-start.sh`, and send Claude a screenshot. |
| The bot runs but something's broken | Tell Claude. Claude undoes the change and pushes; you run `host-update.sh` again. |
| The data looks wrong | See **section 10** and load the backup from `backups/before-update/`. |

---

## 7. One-time: set up your PC as a test machine

Your PC's `.env` has the **real** token. If you ever double-clicked `start.bat` now, the real bot would run twice. This section gives your PC its own **test bot** so that can't happen. It takes about 10 minutes.

**7.1: Keep a copy of the real settings** (for emergencies only)
In VS Code's file list: right-click `.env` → **Copy** → right-click an empty spot → **Paste** → rename `.env copy` to **`.env.production`**.

**7.2: Make a test server**
In Discord: **+** (bottom of the server list) → **Create My Own** → name it `AJ Test`. Then right-click its icon → **Copy Server ID** and paste it into Notepad.

**7.3: Make the test bot**
1. <https://discord.com/developers/applications> → **New Application** → name it `Angel's Judgement Test` → **Create**.
2. Copy the **Application ID** into Notepad.
3. **Bot** tab → **Reset Token** → copy the token into Notepad. On the same tab, turn **Message Content Intent** ON → **Save Changes**.
4. Open this link with `TEST_APP_ID` replaced by the Application ID, pick **AJ Test**, and click **Authorize**:
   ```
   https://discord.com/oauth2/authorize?client_id=TEST_APP_ID&permissions=268561488&scope=bot%20applications.commands
   ```

**7.4: Two dummy bots** (the live test uses them as pretend players; they never need to be switched on)
Make two more applications named `AJ Dummy 1` and `AJ Dummy 2`. Invite each one with this link, `DUMMY_APP_ID` replaced by its Application ID:
```
https://discord.com/oauth2/authorize?client_id=DUMMY_APP_ID&permissions=0&scope=bot
```

**7.5: Make the test settings file**
Copy `.env` again (like 7.1) and name it **`.env.test`**. Open it and change:
- `DISCORD_TOKEN=` → the **test** bot's token
- `DISCORD_GUILD_ID=` → the **AJ Test** server ID

Save with **Ctrl + S**.

**7.6: Switch to the test bot**
Double-click **`use-test-bot.bat`**.

**Done.** From now on `start.bat` runs the **test** bot in AJ Test. As extra protection:
- If your PC ever has the real settings, `start.bat` warns you and asks first.
- `npm run smoke` refuses to run with the real token.

---

## 8. Disaster: Shulker lost everything, rebuild it

**When:** Shulker was reinstalled or wiped, and `host-logs.sh` says `No such file or directory`.
**Your data is safe** in Discord **#bot-backups**. This takes about 15 minutes.

**1. Install git and download the bot:**
```
apk add git
```
```
mkdir -p /data && git clone https://github.com/DebugNova/Angel-s-Judgement-Discord-bot.git /data/bot
```

**2. Run the setup** (2–5 minutes; it may look stuck, which is normal):
```
sh /data/bot/scripts/host-setup.sh
```
It must end with **`Setup finished. The bot is not running yet.`**

**3. Put in your settings.** Replace the CAPITAL words and paste one line at a time.

Your user ID is `570305202809208833`. The channel ID comes from Discord: right-click **#bot-backups** → **Copy Channel ID**.
```
sh /data/bot/scripts/host-env.sh BOT_OWNER_IDS 570305202809208833
```
```
sh /data/bot/scripts/host-env.sh BACKUP_CHANNEL_ID YOUR_CHANNEL_ID
```
For the token, copy the value after `DISCORD_TOKEN=` from **`.env.production`** on your PC (or `.env`, if you haven't done section 7). **Don't screenshot this step.**
```
sh /data/bot/scripts/host-env.sh DISCORD_TOKEN YOUR_TOKEN
```
Check (safe to screenshot):
```
sh /data/bot/scripts/host-env.sh check
```
You want the token `set`, your IDs shown, `EMBEDDED_DB: false` and `DATABASE_URL: set`.

**4. Get your newest backup from Discord onto Shulker.**
1. In Discord, open **#bot-backups**, right-click the **newest** file (the last message) → **Copy Link**.
2. Paste these into Shulker. In the last one, replace `PASTE_LINK_HERE` with the link and **keep the quotes**:
   ```
   apk add curl
   ```
   ```
   mkdir -p /data/bot/backups
   ```
   ```
   curl -L -o /data/bot/backups/latest.json.gz "PASTE_LINK_HERE"
   ```

> If that doesn't work: download the file from Discord to your PC, then in the Shulker explorer click **data → bot → backups** and upload it there. In step 5, use its real name instead of `latest.json.gz`.

**5. Load it and start the bot:**
```
sh /data/bot/scripts/host-restore.sh backups/latest.json.gz
```
It prints `✓ Restored` with the numbers of players, matches and so on, then **`Restore finished.`** The bot is now running.

**6. Check:**
```
sh /data/bot/scripts/host-logs.sh
```
You want **Bot: RUNNING**. Your members see everything as it was at that backup.

---

## 9. Disaster: Shulker is dead, run the bot from your PC

**When:** Shulker is down for hours or days. The bot runs from your PC until Shulker is back. **Your PC must stay on.**

1. In Discord **#bot-backups**, **download the newest file**. Put it in your bot folder, inside **backups**.
2. Double-click **`use-real-bot.bat`** and press **Y**.
3. In the VS Code terminal, replace `FILENAME` with the file's name (Windows may hide the `.gz` ending; add it):
   ```
   npm run db:restore -- backups/FILENAME --yes
   ```
4. Double-click **`start.bat`**. It warns that this is the real bot. Press **Y**. Keep the window open.

**When Shulker works again, move back.** Do these in this order:
1. Shulker terminal: `sh /data/bot/scripts/host-stop.sh` (in case it started by itself).
2. **Close** `start.bat` on your PC.
3. VS Code terminal: `npm run db:backup`. This saves what happened while the PC was in charge.
4. In the Shulker explorer, click **data → bot → backups**, then upload that new file (it's in your PC's **Satan → backups** folder, newest one).
5. Shulker: `sh /data/bot/scripts/host-restore.sh backups/FILENAME`
6. PC: double-click **`use-test-bot.bat`**.

---

## 10. Undo a mistake: load an older backup

For example after a wrong `/resetstats`.

1. List the backups on Shulker, newest first. Times are UTC; India is 5 h 30 min ahead:
   ```
   ls -lt /data/bot/backups/auto
   ```
2. Load the one you want. This replaces all current data:
   ```
   sh /data/bot/scripts/host-restore.sh backups/auto/FILENAME
   ```
3. Changed your mind? The data from just before is saved in `backups/before-restore/`. Load that one the same way.

Backups made before updates are in `backups/before-update/`. Older ones are in Discord **#bot-backups**; get them onto Shulker as in section 8, step 4.

---

## 11. All commands in one place

**Shulker terminal:**

| To… | Paste |
| --- | --- |
| Check the bot | `sh /data/bot/scripts/host-logs.sh` |
| Start the bot (also after a Shulker restart) | `sh /data/bot/scripts/host-start.sh` |
| Stop the bot | `sh /data/bot/scripts/host-stop.sh` |
| Install the newest version | `sh /data/bot/scripts/host-update.sh` |
| Check the settings | `sh /data/bot/scripts/host-env.sh check` |
| Change a setting | `sh /data/bot/scripts/host-env.sh NAME VALUE` |
| Make a backup now | `npm --prefix /data/bot run db:backup` |
| List backups | `ls -lt /data/bot/backups/auto` |
| Load a backup | `sh /data/bot/scripts/host-restore.sh backups/auto/FILENAME` |
| Space used | `du -sh /data/*` |

**Your PC:**

| To… | Do |
| --- | --- |
| Use the test bot (normal) | Double-click `use-test-bot.bat` |
| Run the test bot | Double-click `start.bat` |
| Emergency: use the real bot | Double-click `use-real-bot.bat` (section 9 only) |
| Automatic tests | `npm run check` |
| Live test in AJ Test | `npm run smoke` |
| Backup of PC data | `npm run db:backup` |

---

## 12. Rules and quick answers

**Rules**
1. **The real bot runs in one place only**, which is Shulker. Otherwise buttons fail and matches get saved in two places.
2. **Test first** (section 6), then update Shulker.
3. **Keep #bot-backups private.**
4. **Never share or screenshot your token** or `.env` files.
5. **Never click "Reinstall container"** on Shulker. It wipes everything (you'd need section 8).
6. **Not sure? Run `host-logs.sh`, screenshot it, and send it to Claude.** Never screenshot the token command.

**Quick answers**
- **Do I need to keep the Shulker tab open?** No. Close it; the bot keeps running.
- **Does the bot restart itself if it crashes?** Yes, within 10 seconds. Only a restart of the whole Shulker server needs `host-start.sh` (section 4).
- **Will an update delete data?** No. It backs up first and never touches the data.
- **Can I change ELO and other settings without an update?** Yes, with `/config` in Discord. It works instantly.
- **Do I need Shulker's $0.50 volume?** No. Your data survives normal restarts; for a full wipe you have the Discord backups (section 8).
- **What's `ORPHAN_DETECTED` in the logs?** Harmless. See section 3.
