# FootballSimulator

A web platform for simulating real-world football leagues. Pick a league, see the current table and fixtures, then predict or simulate the remaining matches while the table updates live.

- **Phase 1 (in progress):** league simulator for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Brasileirão Série A. Available in EN, PT and ES. No accounts: progress is saved in the browser and can be shared by link.
- **Phase 2:** career / mini-game mode. Users pick leagues and play through their own seasons.

## Stack

Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, next-intl, Zustand, Postgres + Drizzle, and Vercel (hosting + cron). Real fixtures and results come from [football-data.org](https://www.football-data.org/) (free tier).

## What's here so far

`src/engine/` holds the simulation engine. It is plain TypeScript with no framework dependencies, so it can run in the browser, in a Web Worker, or on the server.

| Module | Purpose |
|---|---|
| `rng.ts` | Seeded PRNG (mulberry32). The same seed always gives the same simulation. |
| `ratings.ts` | Attack/defence strengths from played matches, shrunk toward a prior early in the season |
| `match.ts` | Expected goals per fixture, Poisson score sampling, and exact home/draw/away probabilities |
| `standings.ts` | League table with per-league tiebreakers (including head-to-head mini-leagues) and points deductions |
| `montecarlo.ts` | Simulates the rest of the season N times to get the probability of each final position |
| `schedule.ts` | Double round-robin fixture generator (used by tests and by phase 2) |

Other modules:

- `src/config/leagues.ts`: tiebreaker order and qualification/relegation zones for each league.
- `src/lib/shareCodec.ts`: compact URL encoding of a user's predictions.
- `src/lib/footballData.ts`: typed football-data.org client and the mapping from its data to engine types.

## Development

Requires Node ≥ 22.18, which runs TypeScript natively.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Environment variables (once the app and sync are in place):

- `FOOTBALL_DATA_API_KEY`: free key from football-data.org
- `DATABASE_URL`: Postgres connection string
- `CRON_SECRET`: protects the sync endpoint

Data provided by football-data.org.
