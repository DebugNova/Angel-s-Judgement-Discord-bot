# 🧪 Testing Angel's Judgement — step by step

Work through this top to bottom. Tick each box as you go. If anything doesn't match the **Expected** line, stop and follow [Reporting a bug](#13-reporting-a-bug).

**Already verified by Claude before handing over:**
- 111 automated tests: rules, ELO, race conditions, moderation, music, /help coverage, and every button/modal handler (simulated).
- A 27-step live smoke test in AJ Test (including moderation and music): private channels and permissions, every panel state, dispute → referee, history, leaderboard, cleanup, and crash recovery.

What's left for you is what only a human can do: **pressing the buttons as real users.**

---

## 0. What you need

| Who | Needed for |
| --- | --- |
| **You** (server owner) | Admin setup, and acting as **referee** (you can't referee your own match) |
| **Player A** and **Player B**: two accounts that are *not* you (friends, or alt accounts) | Playing test matches |
| Optional **Player C**: any third member | Checking that outsiders can't see match rooms or press buttons |

> Only have one friend? Then you + friend are the players for sections 3–5 and 7. For section 6 (referee) you need two *other* people to play while you referee, or give a trusted member a referee role and let them judge a match you play.

Test **inside your real server**. Everything happens in channels only staff and the players can see. Section 12 wipes all test stats when you're done.

---

## 1. Start the bot

- [ ] Double-click **`start.bat`** in the bot folder. A black window opens.
- [ ] **Expected:** within about 15 seconds the window shows `BOT_READY user="Angel's Judgement#6013"` and `COMMANDS_REGISTERED … count=37`.
- [ ] In Discord the bot shows as **online**, *"Watching over the Seven Angels"*.
- [ ] Type `/` in any channel. **Expected:** Angel's Judgement's commands appear (1v1, challenge, stats, leaderboard, …).

Keep that window open the whole time. Closing it stops the bot. Everything the window prints is also saved to `logs/bot-<date>.log`.

---

## 2. One-time setup (you, as owner)

Create these (names are suggestions):

- [ ] A **category** `⚔️ 1V1 DUELS`. Make it private: @everyone ✗ View Channel. The bot manages each match channel's permissions itself.
- [ ] `#match-history` (everyone can read), `#leaderboard` (everyone can read, nobody can type)
- [ ] `#referee-alerts` and `#bot-logs` (staff only)

Then run:

- [ ] `/config channel matches category:⚔️ 1V1 DUELS` → green ✨ "Configuration updated". No ⚠️ missing-permissions warning.
- [ ] `/config channel history channel:#match-history`
- [ ] `/config channel leaderboard channel:#leaderboard` → **Expected:** a "SEVEN ANGELS — CURRENT 1V1 RANKINGS" panel appears in #leaderboard.
- [ ] `/config channel staff channel:#referee-alerts`
- [ ] `/config channel logs channel:#bot-logs` → **Expected:** from now on #bot-logs receives an entry for every change.
- [ ] `/config roles level:referee` → a role picker appears. Pick your referee/staff role(s). **Expected:** "✅ referee roles set to …".
- [ ] `/config roles level:moderator` → pick your moderator role(s).
- [ ] **Faster testing (optional):** `/config leaderboard min_matches:1` (so players show on the leaderboard after 1 match) and `/config matches delete_after:5 minutes`.
- [ ] `/config view` → **Expected:** every channel and role you set is listed.

---

## 3. Basic commands (anyone)

- [ ] `/help` → only you can see it. Pick each category in the menu; the text changes.
- [ ] `/about` → gold "ANGEL'S JUDGEMENT — SEVEN ANGELS" card with the lore.
- [ ] `/botstatus` → Online, Database Connected, latency. As an admin you also see "Technical (admin only)".
- [ ] `/stats` → your profile: ELO **1,000**, Rank "Unranked (0/…)", Choir of the Virtues.
- [ ] `/leaderboard` → "No ranked angels yet".
- [ ] `/currentmatch` → "You are not currently in a match."

---

## 4. Challenges

Player A and Player B in any normal channel:

- [ ] **A:** `/1v1 opponent:@B` → **Expected:** public 🟡 "1v1 CHALLENGE" card that pings B, with **Accept / Decline / Cancel Challenge** and an "Expires in 1 minute" countdown.
- [ ] **A** presses **Accept** → private error "Only @B can respond to this challenge."
- [ ] **C** (or you) presses **Decline** → same kind of error. Nothing changes.
- [ ] **B** presses **Decline** → the card turns grey "CHALLENGE DECLINED" and the buttons disappear.
- [ ] **A:** `/1v1 @B` again right away → ⚠️ "Cooldown active … you can challenge each other again in ~1 minute".
- [ ] **A:** `/1v1 @A` (themself) → ⚠️ "You cannot challenge yourself."
- [ ] **A:** `/1v1 @<a bot>` → ⚠️ "Bots cannot be challenged."
- [ ] After the cooldown, **A:** `/1v1 @B` → **A** presses **Cancel Challenge** → "CHALLENGE CANCELLED".
- [ ] **A:** `/1v1 @B` and nobody presses anything for 60 s → the card turns into "CHALLENGE EXPIRED — @B did not respond within the allowed time."
- [ ] **A:** `/1v1 @B`, then quickly `/1v1 @C` → ⚠️ "You already have a pending challenge." Cancel the first one afterwards.

---

## 5. A full match: report → confirm

- [ ] **A:** `/1v1 @B` → **B** presses **Accept**.
- [ ] **Expected:** the card turns 🔵 "CHALLENGE ACCEPTED" and shows **Match ID `SA-000001`** and a link to **#queue-001**.
- [ ] In `⚔️ 1V1 DUELS` a channel `#queue-001` appears. A and B are pinged: "your arena is ready".
- [ ] The panel shows: Match ID, Format 1v1, Status 🔵 Active, both players at 1,000 ELO, "How it works", your staff roles, and buttons **Report Result / Submit Server Link / Request Cancel**.
- [ ] **Privacy check:** **C** (not staff) can **not** see #queue-001. Staff (referee role) **can**.
- [ ] **A** presses **Submit Server Link** → a form opens → type `hello` → ⚠️ "That does not look like a valid link."
- [ ] Again with `https://www.roblox.com/share?code=test` → "Server link saved". The panel re-posts at the bottom showing the link.
- [ ] **Evidence:** A uploads any image in #queue-001 → **Expected:** the bot reacts 📎 to it.
- [ ] **Sticky panel:** A and B send 5+ chat messages quickly, then wait ~10 s → the panel re-posts itself at the bottom.
- [ ] `/currentmatch` (as A) → shows SA-000001, opponent B, 🔵 Active.
- [ ] **C** presses **Report Result** → "Only the players in this match can report the result."
- [ ] **A** presses **Report Result** → private menu "Who won?" → choose **Me — A**.
- [ ] **Expected:** "✅ Result reported". The panel re-posts as 🏆 **RESULT PENDING**, pings B, with **Confirm Result / Dispute Result**.
- [ ] **A** presses **Confirm Result** → "You reported this result. Waiting for @B to confirm."
- [ ] **B** presses **Confirm Result**.
- [ ] **Expected in #queue-001:** 🏆 **MATCH COMPLETED**. Winner A, loser B, Method "Opponent Confirmation", and ELO **A 1,000 → 1,024 (+24)**, **B 1,000 → 976 (−24)**, plus "archived in X minutes". A and B can no longer type there.
- [ ] **Expected in #match-history:** "1v1 MATCH COMPLETE", A defeated B, +16 / −16, *no server link shown*.
- [ ] **Expected in #leaderboard** (within ~5 s, if min_matches is 1): A #1 1,016, B #2 984, edited in place (no new message).
- [ ] B presses **Confirm Result** again on an old panel (if one is still visible) → "already finalized" or "no longer available". **ELO does not change again.**
- [ ] `/stats` as A → 1,024 ELO, 1 match, 1 win, 100% win rate, streak 1 Win, recent results 🟢 W.
- [ ] `/history` as A → SA-000001 vs B, **+24 ELO**.
- [ ] `/headtohead opponent:@B` (as A) → 1 match, A leads 1–0.
- [ ] After the delete delay (5 or 10 min) → #queue-001 is deleted automatically.

---

## 6. Dispute → referee (you referee; A and B play)

- [ ] A and B start a new match (`/1v1`, Accept).
- [ ] **A** reports **Me** as winner. **B** presses **Dispute Result**.
- [ ] **Expected in the match room:** 🚨 **MATCH DISPUTED**, pinging your referee roles, with a **Review Match (Staff)** button.
- [ ] **Expected in #referee-alerts:** 🚨 "DISPUTED MATCH" card with a **Review Match** button.
- [ ] **A** (a player) presses **Review Match** → 🔒 permission denied.
- [ ] **You** press **Review Match** → a private ⚖️ **MATCH REVIEW** panel (players, reported winner, evidence count, server link Available/Not submitted). The match panel now shows 🟣 **UNDER REVIEW** with you as referee.
- [ ] Press **Request Evidence** → A and B are pinged in the match room with a 📎 "EVIDENCE REQUESTED" card.
- [ ] B uploads a screenshot → 📎 reaction. `/match evidence` inside the match room → lists the file.
- [ ] Press **Review Match** again → **Award Win → B** → ⚠️ "Confirm Decision" card listing what will change → **Confirm Decision** → a form asks for a reason → type `Screenshot shows B won` → submit.
- [ ] **Expected:** "Decision applied … ELO: +X / −X". The room shows **MATCH COMPLETED**, Method **Referee Decision**, Referee **you**, Reason. #match-history shows **MATCH RESOLVED** with the referee and reason. #bot-logs shows `MATCH_DECISION`.
- [ ] Try to award it again (old review panel) → "already been finalized". ELO unchanged.

---

## 7. Cancelling

- [ ] New match A vs B. **A** presses **Request Cancel** → the panel shows "Cancellation requested by A" with **Agree to Cancel / Keep Playing**, and pings B.
- [ ] **B** presses **Keep Playing** → the request disappears.
- [ ] **A** requests again, **B** presses **Agree to Cancel** → ⚫ **MATCH CANCELLED**. Nobody's stats change (check `/stats`).
- [ ] New match, A reports, B disputes → **A** runs `/match cancel` → "This match is under dispute. Only staff can cancel it now."
- [ ] **You** in that room: `/match cancel match_id:<its ID>` → confirmation → **Confirm Cancellation** → reason form → cancelled.

---

## 8. Staff commands (you)

- [ ] `/match view match_id:` → start typing `1`; autocomplete suggests matches. Pick one → full details, including staff fields.
- [ ] `/match search status:completed` → paginated list.
- [ ] `/match note note:test note` inside a match room → "Note added". `/match view` shows it under Staff Notes.
- [ ] `/match decide winner:@A` on an **active** match → "no reported or disputed result… use /match forcecomplete".
- [ ] `/match forcecomplete winner:@A` inside an active match room → confirm → reason → completed (Method "Staff Force-Complete").
- [ ] `/match reopen` on a cancelled match (players must be free) → the match is active again and the players can type again.
- [ ] `/match reopen` on a **completed** match → refused ("final and cannot be reopened").
- [ ] `/player inspect user:@A` → full record + recent audit events.
- [ ] `/player search query:<part of a name>` → finds them.
- [ ] `/player ban user:@A reason:test` → A tries `/1v1 @B` → "You are currently restricted…". `/player unban user:@A` → A can play again.
- [ ] Using any staff command from a **non-staff** account → "🔒 You do not have permission to use this command."

---

## 9. Admin commands (you)

- [ ] `/maintenance enabled:true message:Testing` → A tries `/1v1` → ⚠️ "Testing". `/maintenance enabled:false` → works again.
- [ ] `/config display emojis:false` → new cards show no emojis. Set it back to `true`.
- [ ] `/config season action:start name:Season 1` → `/about` shows Season 1.
- [ ] `/resetstats scope:streak` → red DANGER card → **Proceed** → type `reset` → "The confirmation did not match. Nothing was reset."
- [ ] Repeat, and type exactly `RESET SEVEN ANGELS` → streaks reset.

---

## 9b. Moderation (you + an alt account; never on real members)

Only members with the **moderation role** can moderate (clan server: **z**; AJ Test: a test role also called **z**). Being owner or admin is not enough. Your alt account plays the troublemaker. It must have **no** z role.

- [ ] From the **alt**: `/warn` → 🔒 "Moderation is reserved for @z". Nothing happens.
- [ ] `/warn member:@alt reason:test` → private "⚠️ Warning · Case #1". The alt gets a DM. **#mod-log** shows the case card (member, moderator, reason, DM delivered).
- [ ] `/warnings member:@alt` → their record: 1 active warning, the case listed. `/unwarn case:1 reason:mistake` → "Warning #1 removed" (also in #mod-log). `/warnings` again → 0 active, the case shown ~~removed~~.
- [ ] `/timeout member:@alt duration:` → a list of choices appears (5 minutes, 1 hour…). Pick **5 minutes** → the alt can't type. `/untimeout member:@alt` → they can type again.
- [ ] `/timeout member:@alt duration:banana` → "`banana` is not a duration…".
- [ ] `/warn member:@you` (yourself) → "You can't warn yourself." Same for the server owner and the bot.
- [ ] `/kick member:@alt reason:test` → red **Confirm kick** card with **Kick** / **Cancel**. **Cancel** → "Nothing was done". Run it again → **Kick** → the alt is removed and got a DM first. Re-invite the alt.
- [ ] `/ban user:@alt delete_messages:Last hour` → confirm card → **Ban**. The alt is banned. `/unban user:` → start typing the alt's name → pick it → unbanned. Re-invite the alt.
- [ ] Wait 2 minutes on a confirm card, then press the button → "This confirmation has expired".
- [ ] In a channel, send 5 messages containing `hello` and 3 without. `/purge amount:20 contains:hello` → confirm card "5 found" → **Delete 5** → only those 5 are gone. `/purge amount:3` → deletes the last 3 straight away (small purges don't ask).
- [ ] Create a role **Initiate** (below the bot's role). `/role give member:@alt role:@Initiate` → given. `/role take …` → taken.
- [ ] `/role everyone role:@Initiate action:Give to everyone` → preview (how many will get it, time needed) → **Give to N** → a progress card with ▰▰▱ and **Stop** appears in the channel → finishes with "Finished". Then `…action:Take from everyone`.
- [ ] `/role everyone` with a role that has staff powers (e.g. Ban Members) → refused "can't be given to everyone at once".
- [ ] `/slowmode delay:10 seconds` → the alt can only post every 10 s. `/slowmode delay:Off`.
- [ ] `/lock` → a 🔒 notice is posted, the alt can't write. `/unlock` → 🔓 notice, the alt can write again.
- [ ] `/config view` → the **Moderation** section shows the z role, #mod-log and the case count.

---

## 9c. Music (join a voice channel in AJ Test first)

- [ ] `/play song:blinding lights` → the bot joins your voice channel and plays; a **Now Playing** panel appears with a progress bar and buttons.
- [ ] Press **Pause** → music stops, button turns into **Resume**. Press **Resume**.
- [ ] `/play song:<a YouTube link>` → "Added to Queue · Position 1". `/play song:<a Spotify album or playlist link>` → "Added N Songs · From …".
- [ ] Press **Skip** → next song. Press **Back** → previous song again.
- [ ] Press **Queue** → a list only you see, with pages and "Play one of these now…". Pick one → it plays.
- [ ] **Shuffle** and **Loop: Off → Song → Queue**. `/music volume level:60` changes the volume (a short gap is normal); `level:100` goes back to the original, untouched sound.
- [ ] `/music seek to:1:00` → jumps to one minute. `/music remove position:1`, `/music move from:2 to:1`, `/music clear`.
- [ ] `/search song:never gonna give you up` → pick one from the menu → it's added.
- [ ] `/playlist save name:Test` → `/stop` → `/playlist load name:Test` → the songs come back.
- [ ] Leave the voice channel → the panel says "Paused: everyone left". Rejoin → music continues. Stay away 2 minutes → the bot leaves.
- [ ] While music plays, close the bot window and start it again → it rejoins and continues the same song near where it was.
- [ ] `/config roles level:dj` → pick a role your alt doesn't have → the alt can add songs but **Skip** becomes a vote; **Stop**/**Pause** say "Only @DJ can …". Clear the DJ role again (select nothing).

---

## 10. Spam & abuse checks

- [ ] A runs `/stats` 3 times very fast → the 2nd/3rd say "Slow down…".
- [ ] A presses someone else's leaderboard **Next ▶** button → "Run /leaderboard yourself…".
- [ ] Two quick clicks on **Accept** (or Confirm) → only one match / one result. The second click says "no longer available".

---

## 11. Restart safety

- [ ] Start a match A vs B and leave it **Active**.
- [ ] Close the bot window (this stops the bot). Wait 10 s. Double-click `start.bat` again.
- [ ] **Expected:** the bot comes back online. In #queue-XXX the same buttons still work (A can Report, B can Confirm).
- [ ] (Optional) While the bot is **off**, delete the match channel. Start the bot → the channel is recreated and the players are pinged "your match channel was restored".

---

## 12. When you're done testing

- [ ] `/resetstats scope:all delete_history:true` → Proceed → `RESET SEVEN ANGELS`. This wipes all test stats and test match records.
- [ ] Set real values again: `/config leaderboard min_matches:5`, `/config matches delete_after:10 minutes`, `/config season action:end` (if you started one for testing).
- [ ] Delete any leftover test match channels.

---

## 13. Reporting a bug

1. Note **what you did**, **what you expected**, and **what happened**, plus a screenshot if possible.
2. Note the **time** and the **match ID** (e.g. SA-000003), if there is one.
3. Open `logs\bot-<today's date>.log` in the bot folder. The lines around that time (look for `ERROR` or `WARN`) are what Claude needs.
4. Start a new Claude Code conversation in this folder and use the prompt in [docs/DEBUGGING.md](docs/DEBUGGING.md).
