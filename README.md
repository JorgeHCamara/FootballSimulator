# Foot Simu

[footsimu.com](https://footsimu.com) is a free football simulator: a web platform for simulating real-world football leagues. Pick a league, see the current table and fixtures, then predict or simulate the remaining matches while the table updates live.

- **Phase 1:** league simulator for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Brasileirão Séries A and B. Available in EN, PT and ES. No accounts: progress is saved in the browser and can be shared by link.
- **Phase 2:** career / mini-game mode. Users pick leagues and play through their own seasons.

## Stack

Next.js 16 (App Router) + TypeScript, Tailwind CSS 4, next-intl and Zustand, hosted on Vercel. Phase 1 has no database: pages read football-data.org directly and cache it for an hour. Postgres arrives in phase 2 with accounts. Real fixtures and results come from [football-data.org](https://www.football-data.org/) (free tier). Brasileirão Série B isn't in that tier, so it comes from ESPN's public site feed (no key needed; unofficial, so it may change without notice) — see `src/lib/espn.ts`. The site footer credits football-data.org only; ESPN's feed has no attribution terms. A league's source is set with `source` in `src/config/leagues.ts`.

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

Without an API key the site runs on **generated sample leagues** with fictional team names (no banner is shown to visitors). To load the real season:

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

After deploying, set `NEXT_PUBLIC_SITE_URL` to the live domain and `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to your Google Search Console code, then submit `/sitemap.xml` in Search Console.

### Other commands

| Command | What it does |
|---|---|
| `npm run build && npm start` | Production build and server |
| `npm test` | Engine and library unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run test:e2e` | Browser test against a running server (needs Playwright: `npx playwright install chromium`) |

![League page](docs/screenshots/league.png)

## Project layout

| Path | Purpose |
|---|---|
| `src/app/[locale]/` | Home page and `[league]` simulator page (pre-rendered, refreshed hourly) |
| `src/components/` | `LeagueSimulator`, `StandingsTable`, `FixtureList`, `ProbabilityGrid`, header/footer |
| `src/store/simStore.ts` | Predictions per league and season, saved in the browser, with undo |
| `src/workers/montecarlo.worker.ts` | Runs the 10,000-season simulation off the main thread |
| `src/lib/leagueData.ts` | Loads football-data.org data, or the sample league when there's no key |
| `src/lib/shareCodec.ts` | Compact URL encoding of predictions for share links |
| `src/config/leagues.ts` | Tiebreakers and qualification/relegation zones per league |
| `src/i18n/`, `messages/` | Routing and translations (EN, PT, ES) |
| `src/engine/` | Framework-free simulation engine (see below) |

### Simulation engine

`src/engine/` is plain TypeScript with no framework dependencies, so phase 2 can reuse it on the server.

| Module | Purpose |
|---|---|
| `rng.ts` | Seeded PRNG (mulberry32). The same seed always gives the same simulation. |
| `ratings.ts` | Attack/defence strengths from played matches, shrunk toward a prior early in the season |
| `match.ts` | Expected goals per fixture, Poisson score sampling, and exact home/draw/away probabilities |
| `standings.ts` | League table with per-league tiebreakers (including head-to-head mini-leagues) and points deductions |
| `montecarlo.ts` | Simulates the rest of the season N times to get the probability of each final position |
| `schedule.ts` | Double round-robin fixture generator (sample leagues, tests, phase 2) |

Data provided by football-data.org.
