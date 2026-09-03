# Command Reference

![Dino World](../assets/images/banners/eggs_incubator.webp)

Every slash command Dino World registers. Options marked **autocomplete** suggest
valid values as you type — start typing and pick from the list rather than
looking an id up by hand.

New here? The [gameplay guide](gameplay.md) explains the systems these commands
drive, and `/help` walks you through your first ten minutes in Discord.

## 🏞️ Park and building

| Command | What it does | Notes |
| --- | --- | --- |
| `/park view` | Your park dashboard, across four tabs — Park, Animals, Lots, Prestige | Tab buttons switch the same message in place (nothing new gets posted); the tab you're on shows as a disabled button. The Park tab opens by default and renders a map of your lots, falling back to a text-only embed if the map can't render. The Lots tab offers **Build…**/**Upgrade…** dropdowns, priced per option, behind a confirm — see `/build`/`/upgrade` below. Add `user:` to visit another player's park: the same four tabs, read-only (no Collect, Feed all, Build/Upgrade, or other action buttons), with a **Next park ▶** button that survives tab switches to keep walking the ranked list |
| `/park rename` | Rename your park | Up to 60 characters |
| `/park alerts` | Turn proactive park alerts on or off | DM-only warnings before a dino escapes and when your park's income hits its cap. On by default; also turned off by the 🔕 Mute button on an alert itself |
| `/park landmark` | Your park's prestige monument — the six-rung cash-sink ladder | Shows the built and next rungs with a Build button. Purely cosmetic. Also reachable from the Prestige tab of `/park view` |
| `/park motto` | The line visitors see on the Park tab of your park card | Up to 80 characters. Leave the option blank to clear it |
| `/park feature` | Feature one of your dinos on the Animals tab of your park card | Autocomplete: dino. Shows its name and art to anyone visiting. Leave the option blank to clear it. An escaped dino is still a valid choice |
| `/build` | Build on an empty lot | Also offered as a **Build…** dropdown on the Lots tab of `/park view`, behind a confirm — pick a menu option and it doesn't charge until you confirm. Either way, building a paddock carries a **🦕 Assign a dino** button that opens a private dropdown of your free dinos that eat the right food |
| `/upgrade` | Upgrade a lot to the next level | Autocomplete: lot, and the suggestion quotes the price. Costs are also quoted in the insufficient-funds reply. Also offered as an **Upgrade…** dropdown on the Lots tab of `/park view`, behind a confirm |
| `/decorate` | Add decor to a paddock | Autocomplete: lot, item |
| `/dino list` | List every dino you own, with nickname and trait line | Paginated, 10 per page |
| `/dino assign` | Put a dino in a paddock so it starts earning | Autocomplete: dino, lot. The hatch reveal and `/build` offer this as a button instead. This command is still how you MOVE a dino that already has a paddock, and the only way to put a dino in a paddock that halves its comfort — it asks you to confirm first |
| `/dino unassign` | Take a dino out of its paddock | Autocomplete: dino |
| `/dino rename` | Give a dino a nickname | Autocomplete: dino. Up to 32 characters; leave the nickname blank to clear it |

## 🥚 Eggs and hatching

| Command | What it does | Notes |
| --- | --- | --- |
| `/eggs` | Your egg inventory and incubator status | Paginated, 10 per page |
| `/incubate` | Start incubating an egg | Autocomplete: egg. Every surface that hands you an egg — an expedition, the shop, the Gene Lab, `/mythic` — also carries an **🥚 Incubate** button for that egg, so you rarely need to type this |
| `/hatch` | Hatch an egg that has finished incubating | Autocomplete: egg. Reveals the species on a button press, and the reveal offers to put the new dino straight into a paddock: a single matching paddock with room becomes an **Assign** button, several become a dropdown, and none becomes **🏗️ Build a paddock**. Wrong-habitat paddocks are never offered here — `/dino assign` is the only way to make that trade |
| `/mythic` | Trade shards for a Mythic egg | Needs 8.0★ best-ever rating. Asks for confirmation before spending, then carries an **🥚 Incubate** button for the egg |

## 🍖 Care

| Command | What it does | Notes |
| --- | --- | --- |
| `/feed one` | Feed a single dino | Autocomplete: dino, food. Food must match the dino's diet |
| `/feed all` | Feed every hungry dino, hungriest first | |
| `/rescue` | Recapture a dino that escaped | Autocomplete: dino. The reply carries a **🍖 Feed it** button — a recaptured dino comes back hungry. Feeding spends food rather than cash, so that button takes effect on the first click, the same as **Feed all** on `/park view` |

## 🧬 Gene Lab

| Command | What it does | Notes |
| --- | --- | --- |
| `/breed start` | Pair two dinos in the Gene Lab | Autocomplete: parent-a, parent-b. Both must be in a paddock, same rarity, same diet — shows a confirm button with the fee and time before anything happens |
| `/breed status` | Check your pairings in progress | Shows each pairing's remaining time, or that it's ready to claim |
| `/breed claim` | Claim the oldest finished pairing | Reveals the egg's rarity and inherited traits, and carries an **🥚 Incubate** button for it; reports how many more pairings are still waiting if you have several ready at once |
| `/splice` | Re-roll one trait slot on a dino | Autocomplete: dino. Costs 15 shards; shows a confirm button — the replacement is random and can be worse than what you had |

## 🗺️ Expeditions

| Command | What it does | Notes |
| --- | --- | --- |
| `/expedition start` | Send a dig crew out to a site | Autocomplete: site. Also offered as a **🧭 Dig again** button on the `/expedition claim` reply, which quotes today's fee and asks you to confirm before it charges |
| `/expedition status` | Check how long your active expedition has left | |
| `/expedition claim` | Collect the rewards from a returned expedition | Reply names any live cash/egg-odds world event effect, and carries an **🥚 Incubate** button for the egg you just found plus a **🧭 Dig again** button for the same site. Dig again quotes today's fee and asks you to confirm before it charges |

## ⚔️ Battles

| Command | What it does | Notes |
| --- | --- | --- |
| `/battle chapters` | Browse the campaign, your stars, and your energy | Prev/Next buttons |
| `/battle fight` | Send a squad of one to three dinos into a stage | Autocomplete: stage, dino1, dino2, dino3. Costs energy |

## 🛒 Shop and selling

| Command | What it does | Notes |
| --- | --- | --- |
| `/shop view` | Today's eggs, food, decor, and the Daily Deal | The egg set is stable below a 4.0★ best-ever rating — the Daily Deal is what actually changes day to day |
| `/shop egg` | Buy an egg | Autocomplete: rarity. Only rarities currently on offer. The reply carries an **🥚 Incubate** button for the egg you just bought and a **🥚 Buy another** button that quotes today's price and asks you to confirm before it charges |
| `/shop food` | Buy food by item and quantity | Autocomplete: item |
| `/sell` | Sell a dino for cash and shards | Autocomplete: dino |

## 🤝 Trading

| Command | What it does | Notes |
| --- | --- | --- |
| `/trade offer` | Offer a trade to another player | Autocomplete on all six give/want fields |
| `/trade list` | Your pending trades, incoming and outgoing | Paginated, 10 per page |
| `/trade accept` | Accept a trade offered to you | Autocomplete: id |
| `/trade decline` | Decline a trade offered to you | Autocomplete: id |
| `/trade cancel` | Withdraw a trade you sent | Autocomplete: id |

## 📅 Daily loop

| Command | What it does | Notes |
| --- | --- | --- |
| `/daily` | Your daily quest board, streak, and Claim button | Rolls a fresh board the first time you do anything each day (UTC); unclaimed quests expire at reset |
| `/achievements` | Your lifetime achievement tracks, with a Claim all button | Paginated, 10 per page |

## 🎖️ Season track

| Command | What it does | Notes |
| --- | --- | --- |
| `/season` | Your season track — points from nine capped sources, eight reward rungs, and a Claim button | Crossing the 800-point capstone earns a permanent badge, shown on the Prestige tab of `/park view`, whether or not you've claimed a rung. Unclaimed rungs forfeit when the season rolls over |

## 🌍 World

| Command | What it does | Notes |
| --- | --- | --- |
| `/world` | Today's world event, the season, and what changes | Also names tomorrow's event, by name only |

## 📖 Dex

| Command | What it does | Notes |
| --- | --- | --- |
| `/dex list` | Browse every species | Optional filters: rarity, diet, archetype, page. Paginated |
| `/dex view` | One species in detail | Autocomplete: species |

## ⚔️ Duels

| Command | What it does | Notes |
| --- | --- | --- |
| `/duel ghost` | Fight a snapshot of another player's squad | Free — no energy, no rewards. Once per opponent every 6 hours |
| `/duel challenge` | Post a live duel challenge with Accept / Decline | Expires after 15 minutes; squads and ratings resolve when it is clicked |
| `/duel squad` | Pick the dinos you field in duels | Up to 3. Run with no options to go back to your top three by level |
| `/duel record` | Duel rating, win-loss-draw record and recent opponents | Add `player:` to read someone else's |

## 🎡 Park guests

| Command | What it does | Notes |
| --- | --- | --- |
| `/guests view` | Your attendance, its three terms (species variety, attraction draw, Visitor Center level), the attractions you own, and any milestone ready to claim | Attendance is derived fresh every time, never stored. Also reachable from the Prestige tab of `/park view` |
| `/guests build` | Build a new attraction, or upgrade one you already own to its next level | Priced in cash. Each of six kinds unlocks at its own attendance high-water threshold |
| `/guests claim` | Claim any attendance milestone your high-water has crossed | Pays cash, food, shards, or an egg — each milestone once, permanently |

## 🏆 Progress

| Command | What it does | Notes |
| --- | --- | --- |
| `/hub` | What to do right now — everything ready to claim, everything that needs you, what's still cooking, and what you're working toward, on one ephemeral card | Every actionable row carries its own button (crack an egg, claim a dig, feed a hungry paddock, and more), and a 🔄 Refresh button repaints the card after you use one. Also reachable via a **🧭 What now?** button on your park card and on park alert DMs |
| `/top` | Leaderboards by rating, cash, collection, legacy standing, battle stars, duel rating, season points, or attendance | Server or global scope. Up to five **Visit** buttons open the ranked players' parks |
| `/help` | How to play, across **thirteen** topics | Run with no topic for a first-ten-minutes walkthrough |

## ⚙️ Server settings and admin

| Command | What it does | Notes |
| --- | --- | --- |
| `/settings channel` | Set where the bot posts hatch, expedition, breeding, trade, and world-bulletin notifications | **Requires the Manage Server permission**. Doesn't cover the three proactive park alerts (escape warning, income cap, season ending) — those are always a DM, toggled per-player with `/park alerts` |
| `/settings world-news` | Turn the daily world bulletin on or off for this server | **Requires the Manage Server permission**. Posts to the channel set by `/settings channel` — needs one configured to actually post |
| `/admin give` | Grant resources to a player | Autocomplete: dino-species. **Bot owner only** |
| `/admin inspect` | Dump a player's raw state | **Bot owner only** |
| `/admin ledger` | Read a player's transaction ledger | Rows that moved nothing — every feed writes one alongside its food row — are hidden by default and the footer says how many; `show-all: true` lists them. Hiding is display only: `/admin reverse` still takes a hidden row's id. **Bot owner only** |
| `/admin reverse` | Reverse one ledger transaction | Names the player as a confirmation, and moves money only — whatever the charge bought stays. Refuses a charge from before a reset, and reversing a credit takes the cash back. **Bot owner only** |
| `/admin reset` | Reset a player to a fresh start | **Bot owner only** |
| `/admin fast-forward` | Advance a player's clock, for testing | **Bot owner only** |
