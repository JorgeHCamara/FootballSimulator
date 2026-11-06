@AGENTS.md

# Foot Simu

Next.js app for footsimu.com (see README.md for the stack, commands and the
model). The work in progress is listed in [ROADMAP.md](ROADMAP.md).

## Roadmap PR workflow

Roadmap work goes through one pull request per item, reviewed by FootSimu Bot:

1. **One PR per roadmap item**, in the order of ROADMAP.md. Start an item only
   after the previous item's PR is merged into main.
2. **Branch from the latest main** as `roadmap/<N>-<slug>` (the branch named in
   ROADMAP.md). Pull main first, every time, so the work starts from what's on
   main now (the odds snapshots job also commits to main).
3. Implement the item, then run `npm run typecheck`, `npm test`,
   `npm run build` and `npm run test:e2e` (the e2e suite runs against a local
   sample build: `FOOTSIMU_SAMPLE_DATA=1 npm run build && FOOTSIMU_SAMPLE_DATA=1
   npm run start`).
4. **Open a PR titled `[Roadmap N] <title>`** against **`uat`** with a summary,
   a test plan and notes on any screenshots. Set the item to `in-pr` in
   ROADMAP.md in that PR.
5. **Do not merge it.** Wait for FootSimu Bot's review. If a review comment
   starts with `@claude`, fix it on the **same branch** and push (no new PR).
6. A merge into `uat` deploys the Preview Environment, where the owner tests
   it. Only when they ask, open a PR from the same branch to **main** (same
   title), and wait for its review and merge the same way.
7. When the PR to main is merged, the item is `done`: pull main again before
   the next item.
8. **Never push straight to main** for roadmap work.
9. **Never touch** the privacy, about or contact pages, `ads.txt` or the
   AdSense code (the site is under AdSense review), and add no ad slots.

Across all items: Lucide icons only, no emojis; mobile and desktop; the dice
simulator keeps its dice-roll feel (likely rolls only, no percentages); the
share card has no Chance column.

### `@claude` comments on GitHub

There is no `.github/workflows/claude.yml` yet: running Claude Code from
`@claude` comments needs the Claude GitHub App installed on the repository and
an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` repository secret, which
aren't set up. Until then, the Claude Code session working on the item watches
its PR and acts on `@claude` review comments itself. To turn it on later:
install the app (https://github.com/apps/claude), add one of those secrets, and
add a workflow running `anthropics/claude-code-action@v1` on `issue_comment`,
`pull_request_review_comment` and `pull_request_review` events.
