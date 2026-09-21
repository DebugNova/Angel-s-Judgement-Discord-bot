# SEVEN ANGELS — 1v1 MATCHMAKING & RANKING BOT

## MASTER DEVELOPMENT PROMPT

You are an expert Discord bot engineer, backend architect, database designer, UI/UX designer, and security engineer.

Build a **production-ready Discord bot for the Seven Angels Gakuran-based gaming community**.

The bot's initial purpose is:

> **1v1 matchmaking, private match management, result verification, referee review, player statistics, ELO ranking, leaderboards, match history, moderation, and administrative configuration.**

The system must be designed from the beginning so that **Team Matches, Divisions, Tournaments, Seasons, and other competitive formats can be added later without rewriting the core architecture.**

Do NOT build a throwaway/simple bot.

Build it as a modular competitive platform.

---

# 1. CORE CONCEPT

The primary game mode is:

> **1v1 Duel**

A member can challenge another member using a slash command.

Example:

`/1v1 @Player`

The bot must:

1. Verify that both users are members of the Discord server.
2. Verify that neither player is currently in an active match.
3. Verify that neither player has an active pending challenge that conflicts with the new challenge.
4. Create a pending challenge.
5. Send an attractive Discord embed to the challenged player.
6. Give the challenged player buttons:

   * Accept
   * Decline
7. Give the challenger the ability to cancel the challenge.
8. Expire unanswered challenges automatically.
9. Apply appropriate cooldowns.
10. When accepted:

* Create a unique Match ID.
* Create a private temporary match channel.
* Allow the two players and authorized staff/referees to access it.
* Display match information.
* Allow the players to communicate/share their private server link.
* Track the match state.

11. Once the match is completed:

* Allow a player to report the winner.
* Require the opponent to confirm the result.

12. If both agree:

* Finalize the match.
* Update statistics.
* Update ELO.
* Update streaks.
* Record match history.

13. If they disagree:

* Automatically escalate the match to referee/staff review.

14. Authorized referees/moderators/admins can review the match and determine the official winner.
15. The bot then finalizes the result and updates all statistics automatically.

---

# 2. DESIGN PHILOSOPHY

The bot should feel like a serious competitive platform.

The interface should be:

* Clean
* Modern
* Minimal
* Professional
* Discord-native
* Easy to understand
* Consistent
* Visually polished

Use Discord embeds, buttons, select menus, modals, timestamps, status indicators, and pagination wherever appropriate.

Avoid unnecessary emoji spam.

Use a consistent Seven Angels visual identity.

Example status indicators:

* 🟡 Pending
* 🔵 Active
* 🟢 Completed
* 🔴 Disputed
* ⚫ Cancelled
* 🟣 Under Review

However, emojis should remain optional/configurable.

---

# 3. IMPORTANT ARCHITECTURE REQUIREMENT

Use a modular architecture.

Separate the system into modules such as:

```text
Bot
├── Commands
├── Events
├── Matchmaking
├── Challenges
├── Matches
├── Results
├── Referee System
├── Statistics
├── ELO
├── Leaderboards
├── Match History
├── Player Profiles
├── Cooldowns
├── Permissions
├── Configuration
├── Logging
├── Database
├── Channel Manager
├── Role Manager
├── UI / Embeds
└── Future Game Modes
```

The system should later support:

```text
Game Modes
├── 1v1
├── Team
├── Division
├── Tournament
└── Custom
```

Do not hardcode everything specifically for 1v1.

Create a match abstraction where possible.

For example:

```text
Match
- matchId
- gameMode
- players
- teams
- status
- createdAt
- startedAt
- completedAt
- winner
- loser
- resultStatus
- referee
- eloChanges
```

For now:

```text
gameMode = "1v1"
```

Later:

```text
gameMode = "TEAM"
gameMode = "DIVISION"
gameMode = "TOURNAMENT"
```

---

# 4. TECHNOLOGY

Use a modern production-ready stack.

Recommended:

### Backend

* Node.js
* TypeScript
* discord.js
* PostgreSQL

Use Prisma ORM or another strong ORM.

### Configuration

Use environment variables:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=
```

Never hardcode secrets.

### Hosting

The application should be compatible with:

* VPS
* Docker
* Railway
* Render
* Fly.io
* AWS
* Other Node.js hosting platforms

Create a proper production configuration.

---

# 5. DATABASE DESIGN

Create a proper relational database.

At minimum, include these entities.

## Users

```text
User
- id
- discordId
- username
- displayName
- elo
- wins
- losses
- draws
- matchesPlayed
- winRate
- currentWinStreak
- highestWinStreak
- highestElo
- isBanned
- createdAt
- updatedAt
```

---

# 6. MATCH MODEL

Create a Match table.

Suggested fields:

```text
Match
- id
- matchId
- gameMode
- challengerId
- opponentId
- winnerId
- loserId
- status
- resultStatus
- createdAt
- acceptedAt
- startedAt
- completedAt
- cancelledAt
- disputedAt
- reviewedAt
- refereeId
- channelId
- categoryId
- serverLink
- notes
- evidenceRequired
```

Possible statuses:

```text
PENDING
ACCEPTED
ACTIVE
RESULT_PENDING
DISPUTED
UNDER_REVIEW
COMPLETED
CANCELLED
EXPIRED
```

Possible result statuses:

```text
NONE
PLAYER_REPORTED
CONFIRMED
DISPUTED
STAFF_DECIDED
```

---

# 7. CHALLENGE MODEL

Create a separate challenge system.

```text
Challenge
- id
- challengeId
- challengerId
- challengedId
- status
- createdAt
- expiresAt
- respondedAt
```

Statuses:

```text
PENDING
ACCEPTED
DECLINED
CANCELLED
EXPIRED
```

---

# 8. MATCH RESULT MODEL

Create a dedicated result record.

```text
MatchResult
- id
- matchId
- reportedWinnerId
- confirmedWinnerId
- reportedBy
- confirmedBy
- status
- submittedAt
- confirmedAt
- disputedAt
- finalizedAt
```

---

# 9. ELO HISTORY

Do NOT simply overwrite ELO.

Every rating change must be recorded.

```text
EloHistory
- id
- matchId
- playerId
- oldElo
- newElo
- eloChange
- opponentElo
- createdAt
```

This allows historical ranking analysis later.

---

# 10. MATCH HISTORY

Every completed match must remain permanently recorded.

Example:

```text
Match #SA-00142

Player 1: @Nova
Player 2: @Player2

Winner: @Nova
Loser: @Player2

Result: Confirmed
Method: Player Confirmation

Nova:
ELO: 1214 → 1228 (+14)

Player2:
ELO: 1187 → 1173 (-14)

Completed:
September 21, 2026
```

---

# 11. DISCORD CATEGORY CONFIGURATION

The administrator must be able to configure where matches happen.

There should be a configurable:

### Match Category

Example:

```text
⚔️ 1V1 DUELS
```

The bot creates temporary match channels inside this category.

Example:

```text
⚔️ 1V1 DUELS
├── queue-001
├── queue-002
└── queue-003
```

The actual category ID must be stored in the database/configuration.

---

# 12. MATCH CHANNEL PERMISSIONS

When a match starts, create a private channel.

Example:

```text
queue-001
```

Only the following should see it:

* Challenger
* Opponent
* Authorized referees
* Authorized moderators
* Authorized administrators

Everyone else must be denied access.

Use Discord permission overwrites.

Do NOT manually maintain huge user lists unnecessarily.

Use configured staff roles where possible.

---

# 13. MATCH CHANNEL NAMING

Generate clean names.

Examples:

```text
queue-001
queue-002
queue-003
```

or:

```text
1v1-001
1v1-002
1v1-003
```

The match ID should be separate.

Example:

```text
Match ID: SA-000124
Channel: queue-124
```

Never use Discord usernames directly as the database identifier.

---

# 14. MATCH CHANNEL INITIAL EMBED

When a channel is created, send a professional embed.

Example:

```text
⚔️ SEVEN ANGELS — 1v1 MATCH

Match ID
SA-000124

Challenger
@Nova

Opponent
@Player2

Format
1v1

Status
🟢 ACTIVE

ELO
Nova: 1200
Player2: 1200

━━━━━━━━━━━━━━━━

Instructions

1. Share your private server link here.
2. Both players join the server.
3. Complete your match.
4. Report the winner when finished.
5. The opponent must confirm the result.

Staff:
@RefereeRole
```

Include buttons where appropriate.

---

# 15. CHALLENGE COMMAND

Implement:

```text
/1v1 @user
```

Alias:

```text
/challenge @user
```

The command must:

1. Check the target.
2. Prevent self-challenges.
3. Check both users are guild members.
4. Check challenger is not banned.
5. Check target is not banned.
6. Check both users are eligible.
7. Check challenger is not already in an active match.
8. Check target is not already in an active match.
9. Check neither has a conflicting pending challenge.
10. Check cooldowns.
11. Create challenge.
12. Send challenge embed.

---

# 16. CHALLENGE EMBED

Example:

```text
⚔️ 1v1 CHALLENGE

@Nova has challenged @Player2.

Format
1v1

Challenger
@Nova

Opponent
@Player2

Status
🟡 Awaiting response

The challenge expires in:
59 seconds
```

Buttons:

```text
[ Accept ]
[ Decline ]
```

Only the challenged player can use Accept/Decline.

The challenger gets:

```text
[ Cancel Challenge ]
```

---

# 17. CHALLENGE EXPIRATION

Default challenge timeout:

```text
60 seconds
```

Make this configurable.

If no response:

```text
EXPIRED
```

Notify both players.

Example:

```text
⚔️ Challenge Expired

@Player2 did not respond within the allowed time.

The challenge has expired.
```

---

# 18. DECLINE COOLDOWN

If the challenged player declines:

Apply the requested cooldown.

Default:

```text
60 seconds
```

The cooldown should apply to both participants for starting another 1v1 against each other.

Preferably make this configurable.

Do NOT unnecessarily block players from challenging unrelated people unless the administrator explicitly enables a global cooldown.

Recommended configuration:

```text
pairCooldown = 60 seconds
globalCooldown = configurable
```

---

# 19. ACCEPT FLOW

When accepted:

1. Lock the challenge.
2. Prevent double-click acceptance.
3. Verify players are still eligible.
4. Create match.
5. Generate Match ID.
6. Create private channel.
7. Add permissions.
8. Update challenge to ACCEPTED.
9. Set match status ACTIVE.
10. Send match embed.
11. Notify players.
12. Record timestamps.

---

# 20. CONCURRENCY PROTECTION

This is extremely important.

Prevent race conditions such as:

Two people challenging the same player simultaneously.

Example:

```text
A challenges B
C challenges B
```

Only one should succeed if B accepts one.

Use:

* Database transactions
* Unique constraints
* Atomic status updates
* Locks where necessary

Never rely only on in-memory variables.

---

# 21. MATCH STATUS SYSTEM

The bot should always know the exact match state.

```text
PENDING
↓
ACCEPTED
↓
ACTIVE
↓
RESULT_PENDING
↓
CONFIRMED
↓
COMPLETED
```

Alternative dispute:

```text
RESULT_PENDING
↓
DISPUTED
↓
UNDER_REVIEW
↓
STAFF_DECIDED
↓
COMPLETED
```

Cancellation:

```text
ACTIVE
↓
CANCELLED
```

---

# 22. PRIVATE SERVER LINK

Players should be able to post their private server link inside the match channel.

Optionally provide:

```text
[Submit Server Link]
```

This can open a modal.

Fields:

```text
Private Server Link
```

The bot then posts:

```text
🔗 Server Link Submitted

Submitted by:
@Nova

Link:
<private server link>
```

Do not expose the private server link outside the match channel.

---

# 23. MATCH COMPLETION

After players finish:

Provide:

```text
/reportresult
```

or preferably a button:

```text
[ Report Result ]
```

When clicked, open a modal/select menu:

```text
Who won?

○ You
○ Opponent
```

The player selects the winner.

---

# 24. RESULT CONFIRMATION

If Player A reports:

```text
Winner: Player A
```

the bot must NOT immediately finalize.

Instead:

```text
🏆 RESULT REPORTED

@Nova has reported:

Winner:
@Nova

Waiting for @Player2 to confirm.

[ Confirm Result ]
[ Dispute Result ]
```

Only the opponent can confirm/dispute.

---

# 25. CONFIRMATION

If the opponent confirms:

```text
✅ RESULT CONFIRMED

Winner:
@Nova

Loser:
@Player2

The match is now being finalized.

ELO and player statistics will be updated.
```

Then finalize atomically.

---

# 26. DISPUTE SYSTEM

If the opponent presses:

```text
[ Dispute Result ]
```

the match becomes:

```text
DISPUTED
```

Then:

```text
🚨 MATCH DISPUTED

The players did not agree on the reported result.

This match has been escalated to staff review.

Players should provide screenshots or other evidence.

A referee will review the match.
```

---

# 27. REFEREE SYSTEM

Administrators must be able to configure referee roles.

Example:

```text
Referee
Senior Referee
Moderator
Administrator
```

The bot should allow admins to decide which roles can perform staff actions.

Store role IDs in configuration.

Example:

```text
refereeRoles:
- 123456
- 987654
```

Do NOT hardcode role names.

Role names can change.

---

# 28. STAFF PERMISSION LEVELS

Create permission levels.

### Owner

Everything.

### Administrator

Everything except bot ownership/security configuration.

### Moderator

Match moderation, disputes, player actions.

### Referee

Match result review and dispute resolution.

### Member

Normal matchmaking functionality.

These permissions should be configurable.

---

# 29. REFEREE REVIEW

When a match is disputed:

Create a staff notification.

Example:

```text
🚨 DISPUTED MATCH

Match:
SA-000124

Players:
@Nova vs @Player2

Reported Winner:
@Nova

Opponent Response:
DISPUTED

Status:
UNDER REVIEW

[ Review Match ]
```

---

# 30. STAFF REVIEW PANEL

Referee clicks:

```text
[ Review Match ]
```

The bot should provide all information:

```text
MATCH REVIEW

Match ID:
SA-000124

Player 1:
@Nova

Player 2:
@Player2

Reported Winner:
@Nova

Evidence:
Available / Missing

Match Channel:
#queue-124

Created:
Timestamp

Server Link:
Available
```

Buttons:

```text
[ Award Win → Player 1 ]
[ Award Win → Player 2 ]
[ Cancel Match ]
[ Request Evidence ]
```

---

# 31. EVIDENCE SYSTEM

Referees should be able to request evidence.

Command:

```text
/requestevidence
```

or button:

```text
[ Request Evidence ]
```

Players can then upload screenshots directly in the match channel.

The bot should identify/upload evidence metadata if possible.

Store:

```text
evidenceId
matchId
submittedBy
messageId
attachmentUrl
createdAt
```

Do not permanently depend on Discord message history as the only database record.

---

# 32. STAFF FINAL RESULT

Authorized staff can use:

```text
/match decide <matchId> <winner>
```

Example:

```text
/match decide SA-000124 @Nova
```

The bot must confirm before applying.

Example:

```text
⚠️ Confirm Decision

You are awarding the win to:

@Nova

Match:
SA-000124

This will permanently update:
• Wins
• Losses
• ELO
• Win streak
• Match history

[ Confirm Decision ]
[ Cancel ]
```

---

# 33. RESULT FINALIZATION

Once a result is finalized:

Update everything inside a database transaction.

For winner:

```text
wins +1
matchesPlayed +1
currentWinStreak +1
```

For loser:

```text
losses +1
matchesPlayed +1
currentWinStreak = 0
```

Both:

```text
matchesPlayed +1
```

Calculate:

```text
winRate = wins / matchesPlayed * 100
```

Store the result permanently.

---

# 34. ELO SYSTEM

Implement a standard ELO system.

Default starting rating:

```text
1000
```

Default K-factor:

```text
32
```

Make both configurable.

Formula:

```text
Expected Score =
1 / (1 + 10^((OpponentRating - PlayerRating) / 400))
```

Then:

```text
New Rating =
Old Rating + K × (Actual Score - Expected Score)
```

Winner:

```text
Actual Score = 1
```

Loser:

```text
Actual Score = 0
```

Round ratings to integers.

---

# 35. ELO CONFIGURATION

Admin commands:

```text
/config elo starting
/config elo kfactor
```

or a unified:

```text
/config elo
```

Allow configuration of:

```text
Starting ELO
K Factor
Minimum ELO
Maximum ELO
```

Do not allow normal members to change these.

---

# 36. ELO HISTORY

Every completed match must create an ELO history record.

Example:

```text
@Nova
1200 → 1221
+21

@Player2
1200 → 1179
-21
```

This should be visible in match history.

---

# 37. PLAYER STATS

Command:

```text
/stats
```

Should show the caller's profile.

Also:

```text
/stats @user
```

Should show another player's stats.

Example:

```text
⚔️ SEVEN ANGELS — PLAYER PROFILE

@Nova

ELO
1,284

Rank
#7

Matches
42

Wins
29

Losses
13

Win Rate
69.05%

Current Streak
5 Wins

Best Streak
9 Wins

Highest ELO
1,301

━━━━━━━━━━━━━━

Recent Results

W W W L W
```

---

# 38. PLAYER PROFILE

Profile should include:

* Discord username
* Display name
* Avatar
* ELO
* Global rank
* Matches
* Wins
* Losses
* Win rate
* Current streak
* Highest streak
* Highest ELO
* Recent results
* Account creation date
* Competitive activity

Do not expose private administrative information.

---

# 39. LEADERBOARD

Command:

```text
/leaderboard
```

Default:

```text
Top 10
```

Allow:

```text
/leaderboard 10
/leaderboard 20
/leaderboard 30
```

Maximum should be configurable.

---

# 40. PAGINATED LEADERBOARD

Do not dump 30+ users into one massive message.

Create pages.

Example:

```text
🏆 SEVEN ANGELS — LEADERBOARD

Page 1 / 3

#1  @PlayerA     1452 ELO
#2  @PlayerB     1411 ELO
#3  @PlayerC     1398 ELO
#4  @PlayerD     1365 ELO
#5  @PlayerE     1342 ELO
#6  @PlayerF     1310 ELO
#7  @PlayerG     1298 ELO
#8  @PlayerH     1277 ELO
#9  @PlayerI     1254 ELO
#10 @PlayerJ     1240 ELO

[ ◀ Previous ] [ Next ▶ ]
```

Buttons must only be usable appropriately.

---

# 41. LEADERBOARD TYPES

Eventually support:

```text
/leaderboard elo
/leaderboard wins
/leaderboard winrate
/leaderboard streak
/leaderboard matches
```

For now, ELO should be the primary ranking.

Avoid misleading win-rate rankings for players with very few matches.

Add a configurable minimum number of matches for leaderboard eligibility.

Example:

```text
minimumMatches = 5
```

---

# 42. RANK SYSTEM

Calculate global rank dynamically.

Example:

```text
Rank #1
Rank #2
Rank #3
...
```

Do NOT permanently store rank unless necessary.

Calculate based on current ELO.

---

# 43. MATCH HISTORY

Command:

```text
/history
```

or:

```text
/matches
```

Allow:

```text
/history
/history @user
/history @user limit:10
```

Show:

```text
SA-00124
@Nova vs @Player2
Winner: @Nova
+21 ELO
Completed: 21 Sep 2026
```

Paginate results.

---

# 44. CURRENT MATCH

Command:

```text
/currentmatch
```

or:

```text
/match current
```

Example:

```text
⚔️ CURRENT MATCH

Match:
SA-000124

Opponent:
@Player2

Status:
🟢 ACTIVE

Channel:
#queue-124

ELO:
1284 vs 1261
```

If no active match:

```text
You are not currently in a match.
```

---

# 45. MATCH LOOKUP

Staff:

```text
/match view <matchId>
```

Normal users may only view their own matches.

Staff can view any match.

---

# 46. CANCEL MATCH

Players should be able to request cancellation when appropriate.

Command:

```text
/match cancel
```

However, cancellation rules must prevent abuse.

Possible states:

* Before acceptance: freely cancel challenge.
* After acceptance: cancellation may require both players.
* During dispute: only staff can cancel.
* Completed: cannot cancel.

---

# 47. ADMIN RESET SYSTEM

Create extremely dangerous commands with confirmation.

Example:

```text
/resetstats
```

Must require administrator permission.

The bot must NEVER immediately reset everything.

Show:

```text
⚠️ DANGER — RESET ALL STATS

This will reset:

• Wins
• Losses
• Matches
• ELO
• Streaks
• Highest ELO
• Leaderboards

Historical match records will:
[Remain / Be deleted depending on selected option]

This action cannot be casually undone.

Type confirmation:
RESET SEVEN ANGELS
```

Only execute after exact confirmation.

---

# 48. RESET OPTIONS

Support:

```text
/resetstats all
/resetstats @user
/resetstats elo
/resetstats streak
```

Prefer soft-resetting where possible.

Historical records should ideally remain available even if competitive statistics are reset.

---

# 49. SEASON SYSTEM

Design for future seasons.

Even if seasons are not enabled initially, structure the database to support:

```text
Season
- id
- name
- startDate
- endDate
- status
```

A match can belong to:

```text
seasonId
```

Later Seven Angels can run:

```text
Season 1
Season 2
Season 3
```

with separate rankings.

---

# 50. CONFIGURATION SYSTEM

Create an admin configuration system.

Example:

```text
/config
```

Possible settings:

```text
Match Category
History Channel
Leaderboard Channel
Log Channel
Staff Channel
Referee Roles
Moderator Roles
Admin Roles
Challenge Timeout
Cooldown Duration
Starting ELO
K Factor
Minimum Matches
Maximum Active Matches
Match Channel Naming
Automatic Channel Deletion
Evidence Requirement
```

---

# 51. CHANNEL SELECTION

Admins must be able to select channels.

Example:

```text
/config channel matches
/config channel history
/config channel logs
/config channel leaderboard
```

Use Discord channel selectors rather than requiring users to type IDs whenever possible.

Example:

```text
/config channel history
```

Bot opens/selects a channel.

Then store its ID.

---

# 52. HISTORY CHANNEL

Admins can choose a dedicated history channel.

Example:

```text
📜・match-history
```

Every completed match can generate a compact public record.

Example:

```text
🏆 MATCH COMPLETED

Match:
SA-000124

@Nova
defeated
@Player2

ELO:
+21 / -21

Final:
Nova 1 — 0 Player2

Verified:
Player Confirmation

━━━━━━━━━━━━━━
21 September 2026
```

Do not expose private server links or private evidence.

---

# 53. STAFF LOG CHANNEL

Admins can configure:

```text
📋・bot-logs
```

Log important events:

* Challenge created
* Challenge declined
* Challenge expired
* Match created
* Match cancelled
* Result reported
* Result confirmed
* Match disputed
* Evidence requested
* Referee decision
* ELO change
* Stats reset
* Configuration change
* Permission change
* Match channel created
* Match channel deleted

---

# 54. AUDIT LOG

Create a database audit log.

```text
AuditLog
- id
- actorId
- action
- targetId
- matchId
- metadata
- createdAt
```

Example:

```text
Moderator @X
Action:
MATCH_DECISION

Match:
SA-000124

Decision:
@Nova WIN

Timestamp:
...
```

---

# 55. BOT COMMANDS

Implement a comprehensive slash command system.

## MEMBER COMMANDS

```text
/1v1 @user
```

Challenge player.

```text
/stats
```

View own stats.

```text
/stats @user
```

View another player's stats.

```text
/leaderboard
```

View rankings.

```text
/history
```

View own match history.

```text
/history @user
```

View another player's public match history.

```text
/currentmatch
```

View current match.

```text
/match view <matchId>
```

View a match if permitted.

---

# 56. STAFF COMMANDS

```text
/match view <matchId>
```

```text
/match decide <matchId> <winner>
```

```text
/match cancel <matchId>
```

```text
/match forcecomplete <matchId> <winner>
```

```text
/match reopen <matchId>
```

```text
/match evidence <matchId>
```

```text
/match note <matchId> <note>
```

```text
/requestevidence <matchId>
```

---

# 57. ADMIN COMMANDS

```text
/config
```

```text
/config channel
```

```text
/config roles
```

```text
/config elo
```

```text
/config cooldown
```

```text
/config challenge
```

```text
/config matches
```

```text
/config season
```

```text
/resetstats
```

```text
/player reset <user>
```

```text
/player ban <user>
```

```text
/player unban <user>
```

```text
/player inspect <user>
```

```text
/maintenance
```

---

# 58. ROLE CONFIGURATION

Admins must be able to select which roles have bot permissions.

Example:

```text
/config roles referee
```

Select one or multiple roles.

```text
/config roles moderator
```

```text
/config roles administrator
```

Do not depend solely on role names.

Use Discord Role IDs.

---

# 59. PLAYER RESTRICTIONS

Admins should be able to restrict users.

Example:

```text
/player ban @user
```

This should prevent:

* Challenging
* Accepting
* Starting matches
* Reporting results

depending on configuration.

Unban:

```text
/player unban @user
```

---

# 60. MATCHMAKING VALIDATION

Before creating a match, verify:

```text
Player exists
Player is in guild
Player is not banned
Player is not currently playing
Player is not already in a conflicting challenge
Player is not on cooldown
Bot has permission
Match category exists
Bot can create channel
Database is available
```

If any check fails, return a useful error.

Never silently fail.

---

# 61. ERROR HANDLING

Errors must be user-friendly.

Bad:

```text
Interaction failed.
```

Better:

```text
⚠️ Unable to start the match.

@Player2 is already participating in another 1v1.

Please try again later.
```

Log the actual technical error internally.

Never expose stack traces to users.

---

# 62. BUTTON SECURITY

Every button must verify authorization.

Example:

Only challenged player:

```text
Accept
Decline
```

Only players:

```text
Report Result
```

Only opponent:

```text
Confirm Result
Dispute Result
```

Only staff:

```text
Award Winner
Cancel Match
Request Evidence
```

Never trust the button's custom ID alone.

Validate the Discord user and database state.

---

# 63. INTERACTION EXPIRATION

Buttons and menus should remain safe even after long periods.

If the interaction is no longer valid:

```text
This action is no longer available.
The match state has changed.
```

Do not crash.

---

# 64. MATCH CHANNEL AUTO-CLEANUP

After completion, do NOT instantly delete the channel.

Configurable delay:

```text
5 minutes
10 minutes
30 minutes
1 hour
```

Default:

```text
10 minutes
```

Before deletion:

```text
Match completed.

This channel will be archived shortly.
```

Optionally allow admins to disable automatic deletion.

---

# 65. ARCHIVING

Instead of deleting immediately, future versions can support:

```text
ACTIVE MATCH
↓
COMPLETED
↓
ARCHIVED
```

Archived matches remain in database.

The channel can be deleted while the data remains.

---

# 66. ANTI-ABUSE

Implement protections against:

* Spam challenges
* Challenge flooding
* Duplicate challenges
* Double acceptance
* Double result submissions
* Fake staff actions
* Unauthorized buttons
* Race conditions
* Duplicate ELO updates
* Duplicate match finalization

Every match must be finalized exactly once.

Use an idempotent finalization function.

Example:

```text
finalizeMatch(matchId)
```

If called twice:

```text
The match has already been finalized.
```

It must NOT award ELO twice.

---

# 67. DATABASE TRANSACTIONS

The following should be atomic:

```text
Finalize match
+
Update winner
+
Update loser
+
Update ELO
+
Create ELO history
+
Create match result
+
Mark match completed
```

If anything fails, roll back.

Never leave a match half-completed.

---

# 68. PUBLIC LEADERBOARD CHANNEL

Optionally support a dedicated leaderboard channel.

Example:

```text
🏆・leaderboard
```

The bot can maintain a persistent leaderboard message.

Example:

```text
🏆 SEVEN ANGELS

CURRENT 1V1 RANKINGS

#1 @PlayerA — 1452
#2 @PlayerB — 1411
#3 @PlayerC — 1398
...
```

The bot should edit the existing message rather than create hundreds of messages.

---

# 69. PERSISTENT UI

For important panels, prefer editing existing messages.

Examples:

```text
Leaderboard Panel
Match Panel
Configuration Panel
Help Panel
```

Do not unnecessarily spam channels.

---

# 70. RESULT PANEL BEHAVIOR

Inside active match channels, maintain a result/status panel.

Example:

```text
⚔️ MATCH STATUS

SA-000124

@Nova
vs
@Player2

Status:
🟢 ACTIVE

When finished:

[ Report Result ]
```

Once a result is reported:

```text
🏆 RESULT PENDING

Reported Winner:
@Nova

Waiting for:
@Player2

[ Confirm ]
[ Dispute ]
```

If disputed:

```text
🚨 DISPUTED

Awaiting referee review.
```

If completed:

```text
🏆 COMPLETED

Winner:
@Nova

Loser:
@Player2

ELO:
+21 / -21
```

The bot should edit the status panel whenever possible.

---

# 71. IMPORTANT MESSAGE REQUIREMENT

The original concept wants a message to remain the "latest message" in the match channel.

Implement this carefully.

Do NOT create infinite spam.

Instead:

* Maintain a persistent match-status message.
* Whenever appropriate, update/edit that message.
* Optionally move/repost it when necessary if Discord permissions allow.
* Rate-limit updates.
* Never create an infinite message loop.

The purpose is to ensure that the current match controls/status remain easily accessible.

---

# 72. HELP COMMAND

Create:

```text
/help
```

with categories:

```text
1v1 Commands
Player Commands
Match Commands
Staff Commands
Admin Commands
```

Use buttons/select menus for navigation.

Example:

```text
/help

Select a category:

[ 1v1 ]
[ Stats ]
[ Matches ]
[ Staff ]
[ Admin ]
```

---

# 73. BOT ABOUT COMMAND

```text
/about
```

Example:

```text
SEVEN ANGELS BOT

1v1 Matchmaking & Ranking System

Version:
1.0.0

Game Mode:
1v1

Developed for:
Seven Angels
```

---

# 74. STATUS COMMAND

```text
/botstatus
```

Show:

```text
Bot Status
Online

Database
Connected

Latency
32ms

Active Matches
7

Players
184

Completed Matches
1,284
```

Admin-only technical details can be shown separately.

---

# 75. STATISTICS REQUIREMENTS

Track at minimum:

```text
Matches Played
Wins
Losses
Win Rate
ELO
Highest ELO
Current Streak
Longest Win Streak
```

Future fields:

```text
Season Wins
Season Losses
Peak Rank
Total ELO Gained
Total ELO Lost
Opponent Record
Head-to-Head
```

---

# 76. HEAD-TO-HEAD

Future-ready command:

```text
/headtohead @user
```

Example:

```text
HEAD TO HEAD

@Nova vs @Player2

Matches:
8

Nova Wins:
5

Player2 Wins:
3

Last Match:
Nova won

Current Series:
Nova leads 5–3
```

---

# 77. SEARCH SYSTEM

Staff should be able to search:

```text
/match search
/player search
```

Search by:

* Match ID
* Discord user
* Status
* Date
* Winner
* Loser

---

# 78. MATCH ID FORMAT

Use readable IDs.

Example:

```text
SA-000001
SA-000002
SA-000003
```

Never use random unreadable IDs as the user-facing match ID.

Database primary keys can still be UUIDs.

---

# 79. TIME & DATE

Store all timestamps in UTC internally.

Display them through Discord timestamps where possible.

Example:

```text
<t:1770000000:F>
```

This automatically displays local time for users.

---

# 80. FUTURE TEAM SYSTEM

Design the match model so that later we can support:

```text
1v1

2v2
3v3
4v4
5v5
```

Instead of:

```text
challengerId
opponentId
```

eventually support:

```text
Team A
- player1
- player2
- player3

Team B
- player1
- player2
- player3
```

For now, the 1v1 implementation can use two-player teams internally:

```text
Team A = [Player 1]
Team B = [Player 2]
```

This makes future expansion much easier.

---

# 81. FUTURE DIVISION SYSTEM

Seven Angels currently has divisions.

Do not tightly couple divisions into the initial 1v1 system.

Prepare optional fields:

```text
divisionId
teamId
seasonId
tournamentId
```

Later we can support:

```text
Division I
Division II
Division III
```

with independent rankings.

---

# 82. FUTURE TOURNAMENT SYSTEM

Architecture should eventually support:

```text
Tournament
├── Registration
├── Seeding
├── Brackets
├── Matches
├── Winners
└── Finals
```

Do not implement the full tournament system now.

Just ensure the Match model can later contain:

```text
tournamentId
round
bracketPosition
```

---

# 83. FUTURE TEAM RANKING

Eventually support:

```text
Team ELO
Player ELO
Division ELO
Season ELO
```

Do not mix these values.

For now:

```text
1v1 Player ELO
```

is the only active ranking.

---

# 84. ADMIN DASHBOARD

If practical, architect the backend so a future web dashboard can be added.

Potential dashboard:

```text
Seven Angels Admin Panel

Overview
├── Active Matches
├── Pending Challenges
├── Disputes
├── Players
├── Leaderboard
├── Match History
├── Referees
├── Configuration
└── Audit Logs
```

The Discord bot should remain fully functional without the dashboard.

---

# 85. SECURITY

Never trust:

* Discord usernames
* User input
* Button custom IDs
* Client-side values
* Match IDs
* Role names

Always verify against the database and Discord guild.

Prevent:

* SQL injection
* Command abuse
* Permission bypass
* Duplicate transactions
* Unauthorized result decisions
* Unauthorized stat modification

Use parameterized database queries through the ORM.

---

# 86. RATE LIMITING

Implement rate limiting for:

```text
/1v1
/stats
/history
/leaderboard
```

Especially:

```text
/1v1
```

Do not allow someone to spam hundreds of challenges.

Use both:

```text
User cooldown
Pair cooldown
Global matchmaking limits
```

where appropriate.

---

# 87. LOGGING

Use structured logs.

Example:

```text
INFO MATCH_CREATED
matchId=SA-000124
challenger=123
opponent=456
```

```text
INFO MATCH_COMPLETED
matchId=SA-000124
winner=123
loser=456
eloChange=21
```

```text
WARN MATCH_DISPUTED
matchId=SA-000124
```

Do not log sensitive private data unnecessarily.

---

# 88. ENVIRONMENT SEPARATION

Support:

```text
development
staging
production
```

Do not test destructive commands in production.

---

# 89. TESTING

Create tests for:

### Matchmaking

* Challenge valid user
* Challenge self
* Challenge banned user
* Challenge user already in match
* Duplicate challenge
* Challenge expiration
* Challenge cancellation

### Results

* Correct confirmation
* Incorrect confirmation
* Dispute
* Staff decision
* Duplicate decision

### ELO

* Equal-rated players
* Higher-rated beats lower-rated
* Lower-rated beats higher-rated
* Correct rounding
* ELO history

### Permissions

* Member cannot referee
* Referee can review
* Moderator can moderate
* Admin can configure
* Unauthorized button clicks fail

### Concurrency

Test simultaneous:

```text
Accept
Accept
Report
Report
Finalize
Finalize
```

There must never be duplicate ELO rewards.

---

# 90. ERROR RECOVERY

If the bot crashes while a match is active:

When it restarts:

1. Read active matches from database.
2. Reconstruct state.
3. Verify channels still exist.
4. Continue operating normally.
5. Never lose match state.

Do NOT depend on RAM for important state.

---

# 91. BOT RESTART SAFETY

After restart:

```text
Active matches remain active.
Pending challenges remain valid if not expired.
Completed matches remain completed.
ELO remains unchanged.
```

Run a cleanup job for expired challenges and orphaned channels.

---

# 92. ORPHAN CHANNEL CLEANUP

Detect cases where:

```text
Discord channel exists
but database match does not
```

or:

```text
Database match exists
but Discord channel no longer exists
```

Log the issue and recover safely.

Never automatically destroy potentially important match data.

---

# 93. DATABASE BACKUPS

Production deployment should support regular PostgreSQL backups.

Never treat Discord messages as the database.

The database is the source of truth.

---

# 94. CONFIGURATION DEFAULTS

Provide sensible defaults:

```text
Starting ELO = 1000
K Factor = 32
Challenge timeout = 60 seconds
Pair cooldown = 60 seconds
Minimum leaderboard matches = 5
Match channel auto-delete = 10 minutes
```

Everything important should be configurable.

---

# 95. COMMAND DESIGN

Use Discord slash-command autocomplete/selectors where useful.

Avoid commands requiring IDs when Discord selectors can be used.

For example:

Instead of:

```text
/config channel history 123456789
```

prefer:

```text
/config channel history
```

followed by a Discord channel selector.

---

# 96. COMMAND PERMISSION UX

Unauthorized users should receive:

```text
🔒 You do not have permission to use this command.
```

Do not expose internal permission details.

---

# 97. MATCH RESULT UX

The result system must strongly prevent cheating.

Never allow:

```text
Player A reports win
→ instantly receives ELO
```

Instead:

```text
Player A reports
↓
Player B confirms
↓
OR
Player B disputes
↓
Referee reviews
↓
Official decision
↓
ELO update
```

This is a core feature.

---

# 98. PUBLIC MATCH RECORD

After completion, create a clean record in the configured history channel.

Example:

```text
🏆 1v1 MATCH COMPLETE

SA-000124

@Nova
VS
@Player2

Winner
@Nova

ELO
+21 / -21

Result
Verified

Method
Opponent Confirmation

<t:TIMESTAMP:F>
```

Do not include private evidence or server links.

---

# 99. REFEREE DECISION RECORD

If staff decides:

```text
🏆 MATCH RESOLVED

SA-000124

Winner:
@Nova

Decision:
Referee Decision

Referee:
@Referee

Reason:
Evidence reviewed

ELO:
+21 / -21
```

The reason should be optional but encouraged.

---

# 100. PLAYER COMMAND SUMMARY

Final member commands should include approximately:

```text
/1v1 @user
/stats
/stats @user
/leaderboard
/history
/history @user
/currentmatch
/headtohead @user
/help
/about
/botstatus
```

---

# 101. STAFF COMMAND SUMMARY

```text
/match view
/match decide
/match cancel
/match reopen
/match evidence
/match note
/requestevidence
/player inspect
```

---

# 102. ADMIN COMMAND SUMMARY

```text
/config
/config channel
/config roles
/config elo
/config cooldown
/config challenge
/config matches
/config season

/resetstats
/player reset
/player ban
/player unban
/maintenance
```

---

# 103. FUTURE COMMAND COMPATIBILITY

Reserve command namespaces for future:

```text
/team
/division
/tournament
/season
```

Do not implement unnecessary future functionality yet.

---

# 104. DATABASE RELATIONSHIPS

Design proper relationships.

Example:

```text
User
 ├── Matches
 ├── ELO History
 ├── Challenges
 ├── Results
 └── Audit Logs

Match
 ├── Players
 ├── Result
 ├── ELO History
 ├── Evidence
 ├── Referee
 └── Season

Season
 └── Matches
```

Use foreign keys and indexes.

---

# 105. PERFORMANCE

Index commonly searched fields:

```text
discordId
matchId
status
winnerId
loserId
createdAt
elo
seasonId
```

Leaderboard queries should be efficient.

History queries should be paginated.

Never load thousands of records unnecessarily.

---

# 106. PAGINATION

Every large result should use pagination.

Examples:

```text
Leaderboard
Match history
Player lists
Staff disputes
Audit logs
```

Buttons:

```text
◀
Page 1 / 5
▶
```

Only the original requester should control personal private pagination where appropriate.

---

# 107. EMBED STYLE

Use consistent embed formatting.

Suggested structure:

```text
TITLE

Short description

━━━━━━━━━━━━━━

FIELD
Value

FIELD
Value

━━━━━━━━━━━━━━

Footer:
Seven Angels • 1v1 System
```

Keep embeds readable on desktop and mobile.

---

# 108. NO MESSAGE SPAM

Do not create unnecessary messages.

Prefer:

```text
edit existing embed
```

over:

```text
send new message
```

for status updates.

For match history, one final public record per match is sufficient.

---

# 109. MATCH CHANNEL LIFE CYCLE

Complete lifecycle:

```text
User executes /1v1
        ↓
Challenge created
        ↓
Opponent accepts
        ↓
Match created
        ↓
Private channel created
        ↓
Players play
        ↓
Player reports winner
        ↓
Opponent confirms
        ↓
OR
Opponent disputes
        ↓
Referee review
        ↓
Official result
        ↓
Stats update
        ↓
ELO update
        ↓
History record
        ↓
Channel archived/deleted
```

---

# 110. IMPORTANT BUSINESS LOGIC

The following must always be true:

### Rule 1

A player cannot participate in two active 1v1 matches.

### Rule 2

A match cannot be finalized twice.

### Rule 3

ELO cannot be awarded twice.

### Rule 4

Only the opponent can confirm a player's reported result.

### Rule 5

Only authorized staff can resolve disputes.

### Rule 6

Completed matches cannot be casually modified.

### Rule 7

Every staff decision is logged.

### Rule 8

Every ELO modification has a history entry.

### Rule 9

Stats and ELO are updated atomically.

### Rule 10

The database is the source of truth.

---

# 111. FUTURE-PROOFING

The code must make it easy to add:

```text
Team matches
Divisions
Division rankings
Tournaments
Brackets
Seasons
Team ELO
Player ELO
Best-of-3
Best-of-5
Custom formats
Tournament points
Achievements
Badges
Titles
Rewards
```

Do not build these now unless required.

Create clean interfaces and database relationships so they can be added later.

---

# 112. ACHIEVEMENTS — FUTURE READY

Potential future achievements:

```text
First Blood
10 Wins
50 Wins
100 Wins
10 Win Streak
Top 10
Top 3
Champion
Undefeated
Comeback
Giant Slayer
```

Do not implement unless requested.

---

# 113. BADGES — FUTURE READY

Player profiles could later show:

```text
🏆 Champion
🔥 10 Win Streak
⚔️ Veteran
👑 Top 10
```

Design the player model so badges can be added later.

---

# 114. ADMIN CONFIGURATION STORAGE

Guild-specific configuration must be stored by guild ID.

Example:

```text
GuildConfig
- guildId
- matchCategoryId
- historyChannelId
- leaderboardChannelId
- logChannelId
- refereeRoleIds
- moderatorRoleIds
- administratorRoleIds
- startingElo
- kFactor
- challengeTimeout
- cooldown
- autoDeleteMatches
- minimumLeaderboardMatches
```

This allows the bot to eventually support multiple Discord servers.

---

# 115. MULTI-GUILD ARCHITECTURE

Although initially designed for Seven Angels, do not hardcode:

```text
Seven Angels guild ID
```

throughout the code.

Treat Seven Angels as the first configured guild.

The bot should technically be capable of supporting multiple guilds later.

---

# 116. DOCUMENTATION

Generate:

```text
README.md
.env.example
database schema
installation instructions
deployment instructions
command documentation
admin documentation
architecture documentation
```

README should explain:

1. Requirements
2. Discord Developer Portal setup
3. Bot permissions
4. Environment variables
5. Database setup
6. Prisma migration
7. Running locally
8. Registering slash commands
9. Production deployment
10. Troubleshooting

---

# 117. DISCORD PERMISSIONS

Request only necessary permissions.

Likely required:

```text
View Channels
Send Messages
Manage Channels
Manage Messages
Embed Links
Read Message History
Use Application Commands
```

Only request additional permissions if actually required.

---

# 118. BOT INVITE

Generate/document the appropriate OAuth2 scopes:

```text
bot
applications.commands
```

and required permissions.

Never request Administrator permission unless absolutely necessary.

---

# 119. CODE QUALITY

Use:

* TypeScript
* Strict typing
* ESLint
* Prettier
* Modular services
* Environment validation
* Error handling
* Database transactions
* Unit tests
* Integration tests

Avoid:

* Massive single-file bot
* Global mutable state
* Hardcoded Discord IDs
* Hardcoded role names
* Hardcoded channel names
* Duplicate business logic

---

# 120. RECOMMENDED PROJECT STRUCTURE

Use a structure similar to:

```text
seven-angels-bot/
│
├── src/
│   ├── commands/
│   │   ├── member/
│   │   ├── staff/
│   │   └── admin/
│   │
│   ├── events/
│   │
│   ├── modules/
│   │   ├── challenges/
│   │   ├── matches/
│   │   ├── results/
│   │   ├── referee/
│   │   ├── elo/
│   │   ├── leaderboard/
│   │   ├── statistics/
│   │   ├── history/
│   │   ├── permissions/
│   │   └── configuration/
│   │
│   ├── database/
│   │
│   ├── services/
│   │
│   ├── utils/
│   │
│   ├── ui/
│   │   ├── embeds/
│   │   ├── buttons/
│   │   ├── modals/
│   │   └── menus/
│   │
│   ├── types/
│   │
│   ├── config/
│   │
│   └── index.ts
│
├── prisma/
│   └── schema.prisma
│
├── tests/
│
├── .env.example
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
└── docker-compose.yml
```

---

# 121. DEVELOPMENT PHASES

Do NOT attempt to write the entire project as one giant untested block.

Build in phases.

## PHASE 1 — FOUNDATION

Implement:

* Discord bot
* TypeScript
* Database
* Guild configuration
* Slash command registration
* Basic permissions
* Logging

---

## PHASE 2 — CHALLENGES

Implement:

```text
/1v1
```

with:

* Challenge creation
* Accept
* Decline
* Cancel
* Expiration
* Cooldowns
* Validation

---

## PHASE 3 — MATCHES

Implement:

* Match creation
* Match ID
* Private channel
* Permissions
* Match status
* Server link
* Match panel

---

## PHASE 4 — RESULTS

Implement:

* Report result
* Confirm
* Dispute
* Result state machine
* Finalization

---

## PHASE 5 — REFEREES

Implement:

* Referee roles
* Review panel
* Evidence
* Staff decisions
* Audit logging

---

## PHASE 6 — STATISTICS

Implement:

* Wins
* Losses
* Matches
* Win rate
* Streaks
* Match history
* Player profiles

---

## PHASE 7 — ELO

Implement:

* Starting ELO
* K-factor
* Rating calculation
* ELO history
* Leaderboard

---

## PHASE 8 — ADMIN

Implement:

* Configuration
* Role configuration
* Channel configuration
* Reset system
* Player restrictions
* Maintenance mode

---

## PHASE 9 — POLISH

Implement:

* Better embeds
* Pagination
* Persistent panels
* Error messages
* Restart recovery
* Cleanup jobs
* Performance optimization

---

## PHASE 10 — TESTING

Test all critical flows.

Especially:

```text
Challenge
→ Accept
→ Match
→ Result
→ Confirm
→ ELO
→ History
```

and:

```text
Challenge
→ Accept
→ Match
→ Result
→ Dispute
→ Referee
→ Decision
→ ELO
→ History
```

---

# 122. FINAL ACCEPTANCE TEST

The finished bot should pass this complete scenario:

### Scenario

Player A runs:

```text
/1v1 @PlayerB
```

Bot verifies both players.

Bot creates challenge.

Player B sees:

```text
@PlayerA challenged you.

[Accept]
[Decline]
```

Player B presses Accept.

Bot creates:

```text
Match ID: SA-000001
Channel: #queue-001
```

Only:

```text
Player A
Player B
Referees
Moderators
Administrators
```

can see it.

The bot posts:

```text
⚔️ MATCH ACTIVE
```

Players share their private server link.

They play.

Player A reports:

```text
Winner: Player A
```

Player B sees:

```text
@PlayerA reported themselves as the winner.

[Confirm Result]
[Dispute Result]
```

### If B confirms:

Bot:

```text
🏆 MATCH COMPLETED

Winner: @PlayerA
Loser: @PlayerB
```

Then:

```text
A:
1000 → 1016

B:
1000 → 984
```

Stats update.

History gets a record.

Leaderboard updates.

Match channel gets archived/deleted according to configuration.

### If B disputes:

Bot:

```text
🚨 MATCH DISPUTED
```

Referees are notified.

Referee opens review.

Players provide screenshots.

Referee chooses:

```text
Player A wins
```

Bot confirms.

Stats/ELO update exactly once.

History records:

```text
Decision Method:
Referee Decision
```

Audit log records:

```text
Referee:
@Referee
Decision:
Player A
```

---

# 123. CRITICAL FINAL REQUIREMENT

Before writing code, first understand the entire architecture.

Do not rush directly into implementation.

First produce:

1. System architecture
2. Database schema
3. State machine
4. Command structure
5. Permission system
6. Folder structure
7. Data flow
8. Security model
9. Future extensibility plan

Then implement the project phase-by-phase.

After each phase:

* Verify the code compiles.
* Verify database migrations.
* Verify commands.
* Verify Discord interactions.
* Verify permissions.
* Verify error handling.
* Verify that existing functionality has not broken.

Never implement fake functionality.

If something cannot be implemented reliably through Discord's API, explain the limitation and implement the closest robust alternative.

The final product must be:

> **A professional Seven Angels competitive 1v1 matchmaking and ranking platform inside Discord, with private match rooms, result verification, referee dispute resolution, ELO, statistics, leaderboards, history, configurable permissions, configurable channels, administrative controls, persistent data, and an architecture ready for future Teams, Divisions, Seasons and Tournaments.**

Do not simplify the requested functionality unless technically necessary.

Do not remove features merely to make implementation easier.

Prioritize correctness, security, maintainability, scalability, and a polished Discord user experience.

# 123. TECHNOLOGY STACK & HOSTING REQUIREMENTS

The Seven Angels bot must be built using a **free-first, self-hostable, future-proof technology stack**.

The goal is to run the entire bot with **₹0/month software/infrastructure cost whenever possible**.

The bot must NOT be architected around expensive cloud services.

## PRIMARY STACK

Use:

### Runtime

**Node.js — LTS version**

### Language

**TypeScript**

Do NOT use Python.

Use strict TypeScript configuration:

```text
strict: true
```

The codebase should be strongly typed and modular.

---

# DISCORD FRAMEWORK

Use:

**discord.js v14+**

Use Discord's native:

* Slash Commands
* Buttons
* Select Menus
* Modals
* Embeds
* Interaction responses
* Permission overwrites
* Threads/channels where appropriate

Do not use outdated Discord libraries.

Keep the Discord API layer isolated from the core business logic so the matchmaking system can later be reused by a web dashboard or another client.

---

# DATABASE

The preferred database should be:

**PostgreSQL**

The application must be designed to work with a standard PostgreSQL database.

For local/self-hosted development, PostgreSQL should be runnable completely free.

Recommended local setup:

```text
PostgreSQL
+
Docker
```

or a native PostgreSQL installation.

---

# ORM

Use:

**Prisma ORM**

Prisma should handle:

* Database schema
* Migrations
* Relations
* Queries
* Transactions
* Type-safe database access

The database layer must be isolated behind services/repositories where practical.

Do not scatter raw SQL throughout the Discord command files.

---

# FREE-FIRST DATABASE STRATEGY

The first choice should be:

```text
Self-hosted PostgreSQL
```

This costs:

```text
₹0
```

when hosted on my own laptop/server.

If a remotely hosted database becomes necessary, use a free-tier service.

**Supabase PostgreSQL may be used as the fallback remote database option.**

Do not make the architecture dependent on Supabase-specific functionality unless necessary.

The application should still work with completely standard PostgreSQL.

This means that if I eventually move from:

```text
Local PostgreSQL
```

to:

```text
Supabase PostgreSQL
```

or another PostgreSQL provider, the application should require minimal changes.

---

# IMPORTANT: DO NOT DEPEND ON PAID SERVICES

Do NOT require:

* AWS
* Google Cloud
* Azure
* Paid Redis
* Paid database hosting
* Paid Discord bot hosting
* Paid monitoring services
* Paid queues
* Paid storage
* Paid APIs

unless absolutely necessary.

If a free/self-hosted alternative exists, prefer it.

---

# REDIS

Redis is NOT required for version 1.

Do not introduce Redis merely because it is commonly used in production architectures.

The initial bot can use:

```text
PostgreSQL
+
Database transactions
+
Indexed queries
```

for matchmaking state and concurrency protection.

If Redis becomes genuinely necessary at scale, design the application so it can be added later without rewriting the system.

For development and the initial Seven Angels deployment:

```text
Redis = NOT REQUIRED
```

---

# CACHE

Do not introduce a paid external caching service.

Use:

* PostgreSQL
* In-memory caching where safe
* TTL-based local caches where appropriate

However:

**Important: never store critical match state only in memory.**

The database must remain the source of truth.

If the bot restarts, active matches must still exist.

---

# JOBS / SCHEDULED TASKS

Do not use paid task/scheduling services.

For tasks such as:

* Challenge expiration
* Match cleanup
* Temporary channel cleanup
* Database maintenance
* Leaderboard refresh

use the Node.js process itself or database-backed scheduling logic.

Scheduled tasks must be restart-safe.

Do NOT assume the process will remain alive forever.

---

# HOSTING REQUIREMENT

The bot must be capable of running entirely from:

### Option 1 — My Laptop

```text
Windows/Linux
↓
Node.js
↓
Seven Angels Bot
↓
PostgreSQL
```

Cost:

```text
₹0/month
```

### Option 2 — Very Cheap VPS

The bot should also run on a small Linux VPS costing approximately:

```text
₹30–₹100/month
```

if such a server is available.

The application must have very low resource requirements.

Do not architect the system as if it requires:

```text
8 CPU cores
16 GB RAM
multiple servers
Kubernetes
microservices
```

The initial deployment should comfortably run as a **single Node.js process + PostgreSQL**.

---

# DOCKER

Provide Docker support.

Create:

```text
Dockerfile
docker-compose.yml
```

The Docker setup should be capable of running:

```text
Seven Angels Bot
+
PostgreSQL
```

locally.

Example architecture:

```text
Docker Compose
│
├── seven-angels-bot
│      └── Node.js + TypeScript
│
└── postgres
       └── PostgreSQL
```

The entire stack should be runnable locally without paying for anything.

---

# PRODUCTION DEPLOYMENT

The project should support two deployment modes.

## DEVELOPMENT

```text
Windows laptop
Node.js
PostgreSQL
.env
```

## PRODUCTION

```text
Linux VPS
Docker
PostgreSQL
Node.js
```

The application should not require a cloud provider.

---

# PROCESS MANAGEMENT

For a VPS deployment, support:

**PM2**

or Docker restart policies.

The bot should automatically restart after:

* Crash
* Server reboot
* Process failure

But restarting must NOT cause duplicate matches, duplicate ELO rewards, or duplicate scheduled operations.

---

# ENVIRONMENT VARIABLES

All secrets/configuration must use environment variables.

Create:

```text
.env.example
```

Example:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=
NODE_ENV=development
```

Never commit:

```text
.env
```

to Git.

Add it to:

```text
.gitignore
```

---

# CONFIGURATION

Do not hardcode:

* Discord bot token
* Guild ID
* Channel IDs
* Role IDs
* Database credentials
* API keys
* Secrets

Discord IDs that are part of server configuration should be stored through the bot's configuration system/database where appropriate.

---

# GITHUB

The project should be GitHub-ready.

Create:

```text
.gitignore
README.md
.env.example
LICENSE
```

The repository should never contain secrets.

Use:

```text
Git
GitHub
```

for version control.

---

# WEB DASHBOARD — FUTURE COMPATIBILITY

The bot does NOT need a web dashboard in version 1.

However, the architecture must allow one to be added later.

If a dashboard is eventually created, use:

```text
Next.js
React
TypeScript
```

The future architecture should look like:

```text
                    ┌─────────────────────┐
                    │   Discord Users     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Discord Bot        │
                    │  Node.js + TS       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    PostgreSQL       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Future Web Dashboard│
                    │ Next.js + React     │
                    └─────────────────────┘
```

Do not build the dashboard now unless explicitly requested.

---

# API ARCHITECTURE

Even though this is initially a Discord-only bot, keep the core business logic independent from Discord.

For example:

```text
Discord Command
      ↓
Match Service
      ↓
Database
```

NOT:

```text
Discord Command
      ↓
Direct database queries everywhere
```

Create services such as:

```text
ChallengeService
MatchService
ResultService
EloService
LeaderboardService
PlayerService
RefereeService
ConfigurationService
```

This allows a future web dashboard to call the same services/API.

---

# BUSINESS LOGIC MUST BE CLIENT-INDEPENDENT

The following logic must NOT depend directly on Discord UI:

* Match creation
* Challenge validation
* Result confirmation
* Dispute resolution
* ELO calculation
* Statistics calculation
* Match finalization
* Player restrictions

Discord should be the interface.

The services should contain the actual business rules.

---

# FUTURE API

If a web dashboard is eventually added, a REST API or another appropriate API layer can be introduced.

Possible future structure:

```text
Discord Bot
      │
      ▼
Application Services
      ▲
      │
REST API
      ▲
      │
Next.js Dashboard
```

Do not implement the API unless needed now.

Architect the application so it can be added later.

---

# FREE HOSTING PRIORITY

When suggesting deployment options, always prioritize:

1. My own laptop — ₹0
2. Self-hosted cheap VPS — approximately ₹30–₹100/month
3. Free-tier PostgreSQL/Supabase if remote database is required
4. Other genuinely free services
5. Paid infrastructure only if absolutely necessary

Do NOT recommend expensive cloud infrastructure for the initial project.

---

# SUPABASE RULE

Supabase is an optional fallback, NOT a mandatory dependency.

Preferred:

```text
Self-hosted PostgreSQL
```

Fallback:

```text
Supabase PostgreSQL
```

The code must use standard PostgreSQL-compatible functionality wherever possible.

Do not use Supabase-specific authentication/storage/realtime features for the Discord bot unless there is a clear technical reason.

This keeps the project portable.

---

# STORAGE

The initial bot should NOT require external file storage.

For evidence/screenshots:

The primary source can be Discord attachments/messages.

The database should store metadata such as:

```text
matchId
submittedBy
discordMessageId
attachmentUrl
timestamp
```

Do not build an expensive cloud-storage system for version 1.

If permanent external evidence storage becomes necessary later, design it as a replaceable storage provider.

---

# MONITORING

Do not require paid monitoring.

Initially use:

* Console logs
* Structured logs
* Discord log channel
* Database audit logs
* Health/status command

Optional future monitoring can be added later.

---

# BACKUPS

Because the bot may eventually contain valuable player statistics and match history, provide a simple PostgreSQL backup strategy.

The backup system must work locally.

Do not require paid backup infrastructure.

Document commands/processes for:

```text
Database backup
Database restore
Migration
Recovery
```

---

# RESOURCE EFFICIENCY

The bot should be lightweight.

Target:

```text
Low CPU
Low RAM
Low network usage
Low database usage
```

Avoid unnecessary:

* Polling
* API requests
* Database queries
* Background workers
* External services

Prefer event-driven Discord interactions.

---

# SCALABILITY

The bot should initially be optimized for:

```text
1 Discord server
Hundreds of players
Thousands of matches
```

But the architecture should eventually be capable of:

```text
Multiple Discord servers
Thousands of players
Large match histories
Multiple seasons
Teams
Divisions
Tournaments
```

Do NOT prematurely introduce microservices.

Start with a:

**Modular Monolith**

Architecture:

```text
One application
│
├── Commands
├── Services
├── Database
├── Matchmaking
├── ELO
├── Referees
└── Configuration
```

This is intentional.

Do not split the project into multiple services unless scale genuinely requires it.

---

# VERSIONING

Use semantic versioning:

```text
1.0.0
1.1.0
1.2.0
2.0.0
```

The initial production release should be:

```text
v1.0.0
```

---

# FINAL TECHNOLOGY DECISION

The official stack for this project is:

```text
Language:
TypeScript

Runtime:
Node.js LTS

Discord:
discord.js v14+

Database:
PostgreSQL

ORM:
Prisma

Containerization:
Docker

Process Management:
PM2 or Docker

Version Control:
Git + GitHub

Optional Remote Database:
Supabase PostgreSQL

Future Web Dashboard:
Next.js + React + TypeScript

Hosting:
Self-hosted laptop or inexpensive VPS

Primary Infrastructure Cost:
₹0/month when self-hosted
```

The bot must be fully functional without AWS, Google Cloud, Azure, Redis, paid hosting, or other paid infrastructure.

---

# FINAL INSTRUCTION TO THE AI

Do not overengineer the initial deployment.

Build a **modular monolith** that is:

* Free to run
* Lightweight
* Self-hostable
* Production-safe
* Database-backed
* Restart-safe
* Type-safe
* Secure
* Easy to maintain
* Easy to migrate
* Easy to expand

The architecture must make it possible to move from:

```text
Laptop
+
Local PostgreSQL
+
Node.js
```

to:

```text
Cheap VPS
+
Docker
+
PostgreSQL
```

and eventually to:

```text
VPS / Cloud
+
PostgreSQL / Supabase
+
Discord Bot
+
Next.js Dashboard
```

without rewriting the core matchmaking, ranking, statistics, or match-management systems.

**Do not introduce paid infrastructure unless there is a specific technical requirement that cannot reasonably be satisfied with a free or self-hosted alternative.**
