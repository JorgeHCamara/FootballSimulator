# Foot Simu

[footsimu.com](https://footsimu.com) is a free football simulator: a web platform for simulating real-world football leagues. Pick a league, see the current table and fixtures, then predict or simulate the remaining matches while the table updates live.

- **Phase 1:** league simulator for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Brasileirão Séries A and B. Available in EN, PT and ES. No accounts: progress is saved in the browser and can be shared by link.
- **Phase 2:** career / mini-game mode. Users pick leagues and play through their own seasons.

## Stack

Next.js 16 (App Router) + TypeScript, Tailwind CSS 4, next-intl and Zustand, hosted on Vercel. Phase 1 has no database: pages read the data feeds directly and cache them for an hour. Postgres arrives in phase 2 with accounts. Real fixtures and results come from ESPN's public site feed (no key needed; unofficial, so it may change without notice) — see `src/lib/espn.ts`. ESPN doesn't publish round numbers, so rounds are rebuilt from kick-off dates, keeping each league to its real number of rounds. [football-data.org](https://www.football-data.org/) (free tier) is the fallback when ESPN fails; Brasileirão Série B and MLS aren't in its free tier, so they have no fallback. MLS is shown as two conference tables (East/West, membership from ESPN's standings feed), with fixtures grouped by calendar week since it has no fixed rounds; set `groups` and `weeklyRounds` in the league config for that. Either way visitors never see made-up clubs. The site footer credits football-data.org only; ESPN's feed has no attribution terms. Each league's ESPN feed (`espn`) and `espnOnly` are set in `src/config/leagues.ts`. Cups (the FA Cup) live in `src/config/cups.ts`: each round's pairings come from ESPN once drawn, undrawn rounds get a deterministic simulated draw (`src/engine/cup.ts`), and clubs are rated from their own league's results scaled by division (`src/engine/cupModel.ts`).

## Deploy

Production runs on Vercel at footsimu.com. See [docs/DEPLOY.md](docs/DEPLOY.md) for the step-by-step setup (domain, environment variables, Google Search Console).

## Run locally

Requires **Node.js 22.18 or newer** (`node -v`).

```bash
git checkout claude/youthful-lamport-0m3vrq
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/en`; `/pt` and `/es` work too.

Every league loads from ESPN's feed, with or without an API key. Generated sample leagues with fictional team names are only used when no source can be reached (e.g. offline) in local development, or when `FOOTSIMU_SAMPLE_DATA=1` is set (the e2e test uses this). A production build on Vercel fails instead of publishing sample data, so the previous deployment stays live. To add football-data.org as the fallback source:

1. Get a free key at https://www.football-data.org/client/register
2. Copy `.env.example` to `.env.local` and set `FOOTBALL_DATA_API_KEY=your-key`
3. Restart `npm run dev`

Real data is cached for an hour, which stays well inside the free tier's limit of 10 requests per minute.

### Renaming clubs

To show a different name than the one football-data.org sends (for example "CA Paranaense" → "Athletico Paranaense"), add an entry to `src/config/teamOverrides.ts`:

```ts
{ match: "CA Paranaense", name: "Athletico Paranaense", shortName: "Athletico-PR", tla: "CAP" },
```

`match` is the club's name as the API sends it (case-insensitive) or its football-data.org team id. `name` is shown in the table, `shortName` in fixtures and on phones, `tla` in the badge; `crest` can replace the crest image. Only what you set changes.

## SEO

Each league × language page is pre-rendered with:
- Keyword-targeted titles and descriptions ("Football Simulator", "Simulador de Futebol", "Simulador do Brasileirão", "Premier League Simulator"…), set per language in `messages/*.json` (`Metadata`, `Seo`, `Faq`).
- Canonical and `hreflang` links (`en`, `pt-BR`, `es`, `x-default`), Open Graph and Twitter cards with generated images (`opengraph-image.tsx`).
- JSON-LD structured data: `WebSite`, `Organization`, `WebApplication`, `BreadcrumbList` and `FAQPage`.
- Crawlable intro, "how it works" and FAQ content, plus internal links between all league simulators.
- `sitemap.xml`, `robots.txt`, web manifest and icons.

Every club of every domestic league also has its own page, `/{locale}/{league}/team/{slug}` (slugs from `src/lib/clubs.ts`: lowercase, accent-free, unique within the league). It shows the club's position, points and form, its chances from the same Monte Carlo as the league page (10,000 seasons, real results only, see `src/lib/clubOutlook.ts`), its finishing-position spread, every remaining game with win/draw/loss odds, the toughest and must-win games and a templated summary (`Club` messages). Each page has its own title, description, canonical and `hreflang` links, a `SportsTeam` JSON-LD block and a card image (`team/[teamSlug]/opengraph-image.tsx`). Pages render on first visit and refresh hourly (ISR), and all of them are in the sitemap. Club names in the tables and fixtures link to them.

Every league game also has a preview page, `/{locale}/{league}/match/{home}-vs-{away}-{yyyy-mm-dd}` (club slugs, and the date in the league's own time zone from `src/config/timezones.ts`; a game moved up to 21 days redirects to its new address, any other date is a 404). It shows the date, kick-off (in the visitor's time zone once loaded) and ground, the match model's win/draw/loss chances, expected goals and five likeliest scores, a dice roll (`sampleLikelyScore`), both clubs' form and places, and "What this result means": the season's Monte Carlo rerun with each result fixed (the likeliest home win, draw and away win scores), with the same draws for every other game, so the change in each club's chances is the result's alone (`resultScenarios` in `src/lib/clubOutlook.ts`, cached per game). Once the game is played the page stays: the final score on top and the odds the model gave at kick-off, labelled "Pre-match prediction" (the model rebuilt from the results before it). Pages refresh hourly, and every 10 minutes on match day (the game's own state is fetched from ESPN). Games from the past 30 days to the next 14 (`inIndexWindow` in `src/lib/matches.ts`) are in the sitemap and linked from club pages; other games' pages load but send `noindex, follow`. Every league game's row on the league page has a chart button to its preview, next to the dice. Each page has its own title, description, `hreflang`, a `SportsEvent` JSON-LD block and a card image.

### Odds snapshots

After each completed round of each domestic league, every club's season chances (title, each place, relegation, expected position and points) are stored in `src/data/snapshots/<CODE>.json`, one line per round, by season. `.github/workflows/odds-snapshots.yml` runs `npm run snapshots` (`scripts/snapshot-odds.ts`) every six hours and commits any new snapshots to `main`; run it by hand from the Actions tab (Run workflow) or locally with `npm run snapshots` (`-- PL BSA` for some leagues, `-- --dry-run` to only print).

A round counts once it and every round before it are played (a game postponed far from its round's dates isn't waited for), and its snapshot is taken as of just after its last kick-off: later results are left out, so a late run records the same numbers. A season's first run stores only the latest round; after that, every newly completed round. Committed JSON was chosen over Vercel Blob or a KV store: no service, token or quota to set up on Vercel Hobby, the history is versioned and reviewable in git, and pages read it from the deployment itself. Each commit redeploys the site (a few per week).

After deploying, set `NEXT_PUBLIC_SITE_URL` to the live domain and `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to your Google Search Console code, then submit `/sitemap.xml` in Search Console.

### Other commands

| Command | What it does |
|---|---|
| `npm run build && npm start` | Production build and server |
| `npm test` | Engine and library unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run snapshots` | Add odds snapshots for newly completed rounds (real data; see Odds snapshots) |
| `npm run test:e2e` | Browser test against a running server built and started with `FOOTSIMU_SAMPLE_DATA=1` (`FOOTSIMU_SAMPLE_DATA=1 npm run build && FOOTSIMU_SAMPLE_DATA=1 npm start`: share pages and cards render on request, so the server needs it too; needs Playwright: `npx playwright install chromium`) |

### Yearly: rebuild priors

The chances in domestic leagues start from `src/data/priors/<year>.ts`, built
from ESPN's results by `scripts/build-priors.ts` (logic in `scripts/priorsLib.ts`).
For each league it holds:

- **clubs**: each club's starting rating, from last season (promoted clubs from
  their rating in the league below, relegated ones the reverse, clubs without
  data a below-average default);
- **rho**: the Dixon–Coles dependence of low scores (negative means more 0–0 and
  1–1 than independent Poisson counts), by maximum likelihood over last season's
  and this season's games with the ratings held fixed, kept within −0.2..0
  (−0.10 for leagues with fewer than 150 games);
- **home**: each returning club's home/away split relative to the league's,
  from the same games, opponent-adjusted, shrunk to the league's
  (w = n / (n + 35), n its home games) and clamped to ±30%. Promoted clubs and
  clubs without data play at the league's home advantage; neutral grounds have none.

Rebuild it once a new season's clubs are on ESPN:

```bash
npm run priors -- 2027
```

This builds the season starting in 2027 (2027/28 for European leagues, 2027 for
calendar-year leagues such as the Brasileirão, MLS, J1 and the South American
leagues) and writes `src/data/priors/2027.ts` and `src/data/priors/index.ts`;
commit both. Calendar-year leagues start in January, so run it then for them, and
again in August for the European ones (leagues whose new season isn't on ESPN yet
are skipped with a warning). Until a season has its own file, the latest earlier
one is used and the server logs a warning, and `npm test` fails once the newest
file is more than one season behind any league's current season.

#### Match model switches and the backtest

`src/engine/ratings.ts` holds three switches, set from a backtest of last season:

| Switch | Now | Why |
|---|---|---|
| `DIXON_COLES` (score distribution with rho) | on | slightly better 1X2 log-loss and Brier score, draw rate close to the real one |
| `TEAM_HOME_ADVANTAGE` (the clubs' home splits) | off | worse in all four leagues tested |
| `RATING_HALF_LIFE` (recency weighting; `ratingHalfLife` per league) | off (`Infinity`) | every half-life from 6 to 40 games scored worse |

To re-run it (predicting each matchday of a past season from earlier games only,
with priors, rho and home splits from the season before):

```bash
npm run backtest -- 2025 PL PD SA BSA
```

![League page](docs/screenshots/league.png)

## Project layout

| Path | Purpose |
|---|---|
| `src/app/[locale]/` | Home page and `[league]` simulator page (pre-rendered, refreshed hourly) |
| `src/components/` | `LeagueSimulator`, `StandingsTable`, `FixtureList`, `ProbabilityGrid`, header/footer |
| `src/store/simStore.ts` | Predictions per league and season, saved in the browser, with undo |
| `src/workers/montecarlo.worker.ts` | Runs the 10,000-season simulation off the main thread |
| `src/lib/leagueData.ts` | Loads ESPN data, falls back to football-data.org, or the sample league in local development |
| `src/lib/shareCodec.ts` | Compact URL encoding of predictions for share links (nothing is stored: the prediction is the link) |
| `src/app/[locale]/[league]/share/[code]/` | Share page (the predicted table, read-only) and its 1200×630 card (`opengraph-image`, `twitter-image`), drawn by `src/lib/shareCard.tsx` from `src/lib/scenario.ts` |
| `src/config/leagues.ts` | Tiebreakers and qualification/relegation zones per league |
| `src/i18n/`, `messages/` | Routing and translations (EN, PT, ES) |
| `src/engine/` | Framework-free simulation engine (see below) |

### Simulation engine

`src/engine/` is plain TypeScript with no framework dependencies, so phase 2 can reuse it on the server.

| Module | Purpose |
|---|---|
| `rng.ts` | Seeded PRNG (mulberry32). The same seed always gives the same simulation. |
| `ratings.ts` | Attack/defence strengths from played matches, adjusted for the opponents' strength and shrunk toward a prior (last season's ratings, see "Yearly: rebuild priors") early in the season |
| `match.ts` | Expected goals per fixture, Poisson score sampling, and exact home/draw/away probabilities |
| `standings.ts` | League table with per-league tiebreakers (including head-to-head mini-leagues) and points deductions |
| `montecarlo.ts` | Simulates the rest of the season N times to get the probability of each final position |
| `schedule.ts` | Double round-robin fixture generator (sample leagues, tests, phase 2) |

Data provided by football-data.org.
