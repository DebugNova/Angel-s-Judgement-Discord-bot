# Admin guide

All settings are per server and take effect immediately. Every change is written to the audit log and the log channel.

## Settings reference

| Command | Option | Default | Notes |
| --- | --- | --- | --- |
| `/config channel matches` | category | — | **Required** before anyone can play |
| `/config channel history · leaderboard · staff · logs` | channel | — | Optional. `/config channel clear` unsets one. |
| `/config channel modlog` | channel | — | Where every moderation case card is posted. Empty = the logs channel. |
| `/config roles` | referee · moderator · admin | — | Role picker; select several or none. Admin roles: owner only. |
| | moderation | z (Seven Angels) | The **only** roles that may use `/ban /kick /timeout /warn /purge /role /slowmode /lock`. Owner, Admin and staff levels don't count. Owner only. Selecting nothing turns moderation off. |
| | dj | none | Who controls the music. None = everyone in the voice channel. With DJ roles, only DJs, moderation-role holders and admins can pause/stop/seek/change volume etc.; others add songs, skip their own and vote to skip. |
| `/config moderation` | dm_members | on | Whether members get a DM about the action by default (each command's `dm` option overrides it) |
| `/config elo` | starting | 1000 | Applies to new players. Use `/resetstats elo` to re-baseline everyone. |
| | kfactor | 120 | Rating swing per match (max points one duel can move; an even duel moves half of it, 60) |
| | minimum / maximum | 0 / 5000 | Ratings are clamped |
| `/config challenge` | timeout | 60 s | Time to accept |
| | max_incoming | 3 | Pending challenges one player can receive |
| `/config cooldown` | pair | 60 s | After a decline, the same two players must wait |
| | global | 0 (off) | After a decline, both players must wait before any challenge |
| | command | 10 s | Between `/1v1` uses per player |
| `/config matches` | max_active | 40 | Discord allows 50 channels per category |
| | auto_delete / delete_after | on / 10 min | Finished channels are locked first, then deleted |
| | channel_prefix | `queue` | `queue-001`, `queue-002`… |
| | id_prefix | `SA` | `SA-000001`… |
| | evidence_required | off | Players must upload a screenshot before reporting |
| | sticky_panel | on | Re-posts the match panel after busy chat |
| `/config leaderboard` | min_matches | 5 | Matches needed to be ranked (prevents 1–0 win-rate leaders) |
| | max_size | 30 | Largest `/leaderboard size` |
| `/config display` | emojis | on | Turns off emojis in embeds and buttons |
| `/config season` | start / end / view | — | Records which season new matches belong to |
| `/music stay` | enabled | off | 24/7 mode: the bot stays in voice when the queue ends or everyone leaves. DJs, moderation-role holders and admins. |

Music volume starts at 100% (the original sound, untouched) when the bot joins; `/music volume` (0–150) changes it until the bot leaves (it survives a bot restart). `/config view` shows the moderation and music settings in their own sections.

## Handling a dispute

1. The staff channel shows **🚨 DISPUTED MATCH** with a **Review Match** button. The same button is on the panel inside the match channel.
2. **Review Match** marks the match *Under Review*, names you as referee, and opens your private review panel: players, reported winner, evidence count, server link status and timestamps.
3. **Request Evidence** pings both players in the match channel. Every file they upload is recorded (`/match evidence` lists them).
4. **Award Win → Player** shows a confirmation listing everything that will change. **Confirm Decision** asks for an optional reason and then applies it.
5. The history channel records *Referee Decision*, the referee and the reason, and the audit log stores the decision.

Other tools: `/match note` for internal notes, `/match reopen` to send the match back to play, `/match cancel` to void it, and `/match forcecomplete` (moderator) to award a match that was never reported.

## Resets

`/resetstats scope:all|elo|streak|user` shows a danger panel. **Proceed** requires typing `RESET SEVEN ANGELS` exactly.

- Resets are **soft**: match history stays. Each ELO reset is itself written to ELO history.
- `delete_history:true` (scope *all* only) also deletes finished match records permanently. **Take a backup first** (`npm run db:backup`).

## Player restrictions

`/player ban @user [reason]` stops the player from challenging, accepting and reporting. They can still confirm or dispute an existing report, so their opponent isn't left stuck, and staff can resolve their current match. `/player unban` lifts it. `/player inspect` shows the full record plus recent audit events.

## Maintenance

`/maintenance enabled:true message:"Back at 8pm"` pauses new challenges and accepts. Matches already in progress finish normally. Moderation and music are not affected.

## Moderation

Moderation is separate from the 1v1 staff levels above: `/player ban` restricts someone from **ranked play**, `/ban` removes them from the **server**.

- Every action gets a **case number** (`Case #12`), is posted publicly in the channel where it was run, gets a card in the mod-log channel, and is written to the audit log. Nothing is recorded unless Discord accepted the action.
- `/warnings @member` shows a member's full record; `/unwarn case:<n>` removes a warning (the case stays, shown as removed).
- Kick, ban, `/role everyone` and purges of more than 10 messages ask for confirmation first. Confirm buttons expire after 2 minutes.
- Nobody can act on themselves, the server owner, the bot, or anyone whose top role is equal to or higher than theirs or the bot's. Roles with staff powers (e.g. Ban Members, Administrator) can't be given to everyone at once.
- `/role everyone` works through the member list at about one member per second, shows live progress and can be stopped halfway. It needs **Server Members Intent** in the Developer Portal.
- `/unlock` restores the channel's exact previous permissions.
- If you ever restore a backup made **before** moderation existed, pick the moderation role again with `/config roles level:moderation`.
