---
description: Full verification sweep — typecheck, offline tests, live REST sweep
---

Run the full verification sweep for this repo, in order, stopping to investigate the first failure rather than re-running blindly:

1. `npm run typecheck`
2. `npm test`
3. If `DISCORD_TOKEN`, `DEV_GUILD_ID`, and `TEST_CHANNEL_ID` are all present in `.env`: `npm run test:live`. Otherwise skip it and say which variable is missing.

Then report:
- pass/fail per step, with test counts
- any payload the live sweep says Discord rejected, by case name
- a reminder that cosmetic review (image renders, emoji art, banners) happens by scrolling the test channel gallery the live sweep just posted — that part stays human.

If a builder changed in this session, remind that `npm run deploy-commands` must run once and that exactly one bot instance may hold the token.
