# Admin guide

All settings are per server and take effect immediately. Every change is written to the audit log and the log channel.

## Settings reference

| Command | Option | Default | Notes |
| --- | --- | --- | --- |
| `/config channel matches` | category | — | **Required** before anyone can play |
| `/config channel history · leaderboard · staff · logs` | channel | — | Optional. `/config channel clear` unsets one. |
| `/config roles` | referee · moderator · admin | — | Role picker; select several or none. Admin roles: owner only. |
| `/config elo` | starting | 1000 | Applies to new players. Use `/resetstats elo` to re-baseline everyone. |
| | kfactor | 32 | Rating swing per match |
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

`/maintenance enabled:true message:"Back at 8pm"` pauses new challenges and accepts. Matches already in progress finish normally.
