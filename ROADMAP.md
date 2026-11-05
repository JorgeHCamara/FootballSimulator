# FootSimu roadmap

Worked **in order**, one branch and one pull request per item (see the
"Roadmap PR workflow" in [CLAUDE.md](CLAUDE.md)). The next item starts only
after the previous item's PR is merged.

Status: `todo` → `in-pr` (its PR is open) → `done` (merged), or `cancelled`.

Every item also has to meet these:

- `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` pass.
- Lucide icons only, no emojis; designed for both mobile and desktop.
- The dice simulator keeps its dice-roll feel: likely rolls only, no percentages.
- The share card has no Chance column.
- The privacy, about and contact pages, `ads.txt` and the AdSense code are not
  touched (the site is under AdSense review); no new ad slots.

Item 0 (setting up this file and the workflow) came first, on `roadmap/0-setup`.

| # | Item | Status | Branch |
|---|---|---|---|
| 1 | Match impact cache key and skeleton | done | `roadmap/1-impact-cache` |
| 2 | Club page Likely finish range | done | `roadmap/2-likely-finish-range` |
| 3 | Rating noise: offline tune | in-pr | `roadmap/3-rating-noise-tune` |
| 4 | Rating noise: live (gated on item 3) | todo | `roadmap/4-rating-noise-live` |
| 5 | Snapshot integrity | todo | `roadmap/5-snapshot-integrity` |
| 6 | Play-offs and MLS Cup on club pages | todo | `roadmap/6-club-playoffs` |
| 7 | Neutral venues | todo | `roadmap/7-neutral-venues` |
| 8 | PL and EFL tiebreakers | todo | `roadmap/8-pl-efl-tiebreakers` |
| 9 | Quiz with historical data | todo | `roadmap/9-quiz-historical` |
| 10 | Prediction league | todo | `roadmap/10-prediction-league` |

## 1. Match impact cache key and skeleton

**Goal:** the match page's "What this result means" is cached by what its
numbers depend on, not by deployment, and its placeholder is the size of the
finished card.

**Acceptance:**

- The match-impact `unstable_cache` key is: league, match slug, the league's
  `dataVersion`, a fingerprint of the league's xG file (`src/data/xg/<CODE>.json`,
  a short hash of its contents, or `"none"`), and a `SIM_VERSION` constant in
  one shared module (e.g. `src/lib/simVersion.ts`), documented as having to
  bump when the Monte Carlo, the impact maths or the rating defaults change.
- `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA` are no longer in the key.
- The loading skeleton in `MatchImpact.tsx` matches the finished card's height
  (about 292px on phones, 259px on desktop) with explicit min-heights, not
  `h-72`; it keeps `data-testid="match-impact-loading"`.
- A focused test that the key (a helper, extracted if needed) has those five
  parts and no deployment id.
- PR: "[Roadmap 1] Match impact cache key and skeleton".

## 2. Club page Likely finish range

**Goal:** the club card shows a "Likely finish" range (e.g. 6th–9th, 83%), the
shortest run of places covering at least 75% of the club's own distribution,
instead of the single place from the one-club-per-place table.

**Acceptance:**

- A pure helper (e.g. `likelyFinishRange(distribution, minCoverage = 0.75)`)
  returns `{ from, to, chance }`: the shortest contiguous run of places whose
  chances add up to at least 75%; ties by length go to the higher summed
  chance, then to the run nearest the club's expected place; if none reaches
  75%, the full 1..n range.
- Each `ClubOutlook` carries the range; `likeliest` stays for the projected
  table and odds snapshots, and `mostLikelyPlaces` is unchanged for them.
- The club page card shows "Likely finish" with e.g. "6th–9th" and "83%" under
  the Lucide target icon; `summaryLikeliest` / `likeliest` copy updated in
  `messages/en.json`, `pt.json` and `es.json`.
- The share card has no Chance column; if its image mentions the finish, the
  range string only.
- Unit tests for the helper.
- PR: "[Roadmap 2] Club page Likely finish range".

## 3. Rating noise: offline tune

**Goal:** confirm rating noise on more seasons and tune how fast it fades,
offline only; the live default stays off.

**Acceptance:**

- `npm run backtest:season` run for every completed past season that loads for
  the ten leagues (2023, and 2022 if ESPN has it), each written to
  `backtest-results/season-<season>.json`; any league/season that can't load is
  skipped and flagged.
- A grid of sd in {0.15, 0.20, 0.25, 0.30} × fade k in {5, 10, 20, 40}
  (sd × √(k / (k + games played))), on all seasons pooled.
- Selection rule: the pair with the best pooled RPS, provided its calibration
  error is no worse than no noise at any checkpoint by more than 0.002, and the
  title Brier is not worse by more than 1% pooled. If no pair meets it, say so
  and recommend keeping noise off.
- A table of RPS, calibration error and title / top places / relegation Brier
  per checkpoint for no noise, the chosen pair and the runner-up, and each
  season separately, in the PR body (or as JSON paths).
- The README season-backtest section explains how to rerun the grid; small
  script/flag helpers only; no pages, dice, ads or AdSense changes.
- PR: "[Roadmap 3] Rating noise offline tune". Item 4 is not started in it.

## 4. Rating noise: live (gated on item 3)

**Goal:** turn the chosen sd and k on for the season outlook, only if item 3
confirmed the selection rule (the chosen pair beats no-noise pooled RPS and
holds in at least 3 seasons). Otherwise this item is **cancelled**: no code PR,
this file is marked so, and work goes on with item 5.

**Acceptance:**

- One config constant with the chosen sd and k (its comment citing the backtest
  file and seasons) as the engine default for the season outlook: title,
  places, relegation and play-off odds, club pages, match impact, the weekly
  odds reports and odds snapshots.
- Noise drawn from the same seeded stream (mulberry32, seed 2026), once per
  simulated season per club, for attack and defence.
- Single-match score probabilities on match preview pages and the dice
  simulator are untouched.
- `SIM_VERSION` bumped so the impact and outlook caches refresh.
- Snapshots carry a `modelVersion` (or similar) so the history chart and the
  weekly reports label the first week after the change as a model change, not
  real movement.
- Tests pinning exact outlook numbers updated; a test that noise is off for the
  dice and match probabilities.
- The PR body reports before/after title, top-4 (or league equivalent) and
  relegation odds for the Premier League, Brasileirão and MLS on today's data.
- The Championship (ELC) snapshot rebuilt if item 5 hasn't landed, or
  coordinated so item 5 isn't blocked.
- PR: "[Roadmap 4] Rating noise live".

## 5. Snapshot integrity

**Goal:** the Championship's stale snapshot is rebuilt, and a check makes sure
the live engine still reproduces every league's latest stored snapshot.

**Acceptance:**

- `src/data/snapshots/ELC.json` rebuilt with the current engine (the odds
  snapshot script's path) and committed.
- A unit or CI check that, for every league file in `src/data/snapshots`, the
  live engine reproduces the latest stored snapshot's headline chances (title /
  top places / relegation / projected place as applicable), failing on drift
  beyond a documented epsilon (an exact match if the rounding allows).
- A short README note on refreshing one league's snapshot and what the drift
  check means.
- No dice, match page, ads or AdSense changes.
- PR: "[Roadmap 5] Snapshot integrity".

## 6. Play-offs and MLS Cup on club pages

**Goal:** club pages show the chance of promotion through the play-offs and of
winning the MLS Cup (or a title play-off), from the Monte Carlo's play-off
winners, not only of finishing in the play-off places.

**Acceptance:**

- `playoffWins` (and, if useful, the final round's `playoffReached`) threaded
  into `ClubOutlook` / the headline chances for leagues with a play-off config;
  the reaches-the-play-off-places chance kept where it still helps.
- Club page cards and EN/PT/ES strings updated; Lucide only; mobile and desktop.
- The brackets already in `src/config/leagues.ts` reused (EFL play-offs, MLS
  Cup, Série B…); no new bracket formats.
- Unit tests for the Championship, Série B and MLS club outlooks.
- PR: "[Roadmap 6] Play-offs and MLS Cup on club pages".

## 7. Neutral venues

**Goal:** the season Monte Carlo honours neutral venues (no home advantage),
from ESPN's `neutralSite` or the venue itself.

**Acceptance:**

- `runMonteCarlo` uses `expectedGoalsNeutral` for `fixture.neutral` games in the
  precomputed samplers, the rating-noise path and the split's pair samplers.
- ESPN events set `neutral` from `competitions[0].neutralSite` when present; if
  not, the venue is compared with the home club's usual ground (its most common
  home venue this season) and a clear difference marks it neutral. Config /
  `cups.ts` / play-off round venue or neutral flags stay the source of truth
  when set.
- Unit tests: a neutral fixture in the Monte Carlo matches `expectedGoalsNeutral`
  rates; the ESPN and venue-heuristic cases.
- PR: "[Roadmap 7] Neutral venues".

## 8. PL and EFL tiebreakers

**Goal:** the Premier League keeps its 2025/26 statistical order and adds the
deciding play-off for meaningful ties; the EFL follows Regulation 9.

**Acceptance:**

- Premier League 2025/26: points, goal difference, goals scored, head-to-head
  points, head-to-head away goals; if still level where the place decides the
  title, a European place or relegation, a one-off play-off at a neutral venue
  (sources cited in code comments: premierleague.com/en/news/58905 and NBC
  Sports' 2026 tiebreaker explainer).
- EFL 2025/26 Regulation 9: points, goal difference, goals scored, head-to-head
  (points, goal difference, goals), wins, away goals, penalty points, then a
  deciding match where the place decides the championship, promotion,
  relegation or play-off entry (source: the EFL regulations PDF). If penalty
  points aren't available from ESPN, the order stops before that step (with a
  comment why) and the deciding match follows where the place matters.
- Tests covering the head-to-head and deciding-match paths; the dice unchanged.
- PR: "[Roadmap 8] PL and EFL tiebreakers".

## 9. Quiz with historical data

**Goal:** a first `/quiz` page (EN/PT/ES) mixing past-winner trivia with
live-model "who is likelier" questions, for traffic and return visits.

**Acceptance:**

- A `/[locale]/quiz` page with a sensible entry link from the home page or nav,
  in EN/PT/ES.
- 5–7 questions a day, picked deterministically from the date and language (the
  same set for everyone): (a) historical questions from a small checked-in
  dataset of past champions / runners-up / relegated clubs of the leagues
  covered; (b) live-model questions asking which of two clubs is likelier for
  the title / top places / relegation from the current outlook, the raw
  percentages shown only after the answer.
- Light UX: Lucide icons, mobile and desktop, clear right/wrong feedback, a
  final score; any share image has no Chance column.
- No dice changes, no new ad slots, no privacy/about/contact, `ads.txt` or
  AdSense changes.
- Unit tests for picking the questions and scoring.
- PR: "[Roadmap 9] Quiz with historical data".

## 10. Prediction league

**Goal:** a light weekly 1X2 prediction league with leaderboards, for
retention, next to the match previews and the quiz; no payments.

**Acceptance:**

- Each week (or matchday) a slate of upcoming league games; the visitor picks
  1X2 for each before kick-off; after the results, points (e.g. 3 for the right
  result, a bonus for the exact score only if scores are collected and it
  doesn't add too much UI).
- Leaderboards for the current week and the season, EN/PT/ES; Lucide only;
  mobile and desktop.
- Friction-light identity for v1 (a local profile name and a shareable join
  code, or similar), not a full auth stack; documented storage (e.g. Vercel KV
  / Postgres / local only) and graceful behaviour when it's unavailable.
- Optional: whether the model agreed with the pick after the game, with no
  percentages on the dice and no Chance column on share cards.
- No privacy/about/contact, `ads.txt` or AdSense changes.
- PR: "[Roadmap 10] Prediction league".
