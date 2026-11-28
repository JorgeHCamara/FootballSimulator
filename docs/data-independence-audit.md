# Data independence audit

**Status:** audit only. No code is changed by this document.
**Audited:** `uat` at `d97733c` (merge of #121), 28 Nov 2026.
**Goal under review:** FootSimu's own store is the source of truth for club names, badges, fixtures and league tables. Outside feeds (ESPN, football-data.org, TheSportsDB, any others) are used only to import new scores and results, through one small, swappable importer.

## Summary

- **FootSimu has no database today.** The README says so ("Phase 1 has no database"). The nearest thing to one is the JSON committed under `src/data/` (snapshots, xG, priors, history, the two first-party leagues). Since #112 the site also reads that JSON at runtime from GitHub (`src/lib/publishedData.ts`). That git-backed, published-JSON pattern already works, costs nothing, and is the natural home for a "FootSimu database". The proposal below builds on it instead of adding a paid service.
- **For 39 of the 41 leagues, all 8 domestic cups and the 5 continental competitions, ESPN's unofficial site API is the live source of truth.** It supplies club names, crests, fixtures, kick-off times, results, match status, groups and points deductions. It is read at request/ISR time through Next's data cache, and is checked every 30 minutes by the refresh job.
- **League tables are already ours.** They are computed from results with each league's own tiebreakers (`computeStandings` in `src/engine/standings.ts`), never copied from a feed. The exceptions are points deductions and conference/group membership, which are read from ESPN's standings endpoint.
- **ESPN's numeric IDs are FootSimu's primary keys everywhere.** They key clubs (`Team.id`), games (`Fixture.id`), priors, snapshots, xG, crest fallbacks, Past Winners/quiz history, share links (fixture order by ID) and visitors' saved predictions (localStorage). A provider switch therefore isn't swappable today.
- **The football-data.org fallback (9 leagues, only when `FOOTBALL_DATA_API_KEY` is set) is quietly broken as a fallback.** It brings its own team and match IDs, so:
  - every club misses its ESPN-keyed prior and starts at the below-average `NO_DATA_PRIOR`;
  - saved predictions and share links don't match;
  - xG isn't attached, and odds snapshots skip the league.
- **Crests are hot-linked from ESPN's CDN** (`a.espncdn.com`) in visitors' browsers, and fetched server-side for the OG/share cards. About 283 others (TheSportsDB fallbacks, Série C from the CBF, Primera B, cut-outs) are self-hosted under `public/crests/` (11 MB).
- **Club slugs, and so every club and match URL, are recomputed at request time from the provider's display name** (after `TEAM_OVERRIDES`). A rename at ESPN would silently change URLs. No live URL contains a provider ID today: the live sitemap checked on 27 Nov 2026 has 702 club slugs, none with an ID suffix. A name clash would add one ("nacional-2154").
- **Smallest path:** freeze what exists now as FootSimu's own records, then move the feeds behind an importer, in this order:
  1. a club registry with frozen slugs, names, colours and provider-ID mappings;
  2. stored seasons (fixtures and results) per league;
  3. one importer interface (ESPN, football-data.org) that only writes changes into the store;
  4. a manual override file for corrections.

  The current numeric IDs are adopted as FootSimu IDs, so snapshots, share links, saved predictions, xG and priors keep working with no migration.

---

## 1. Club names (including EN/PT/ES display names, slugs, aliases)

| | Today |
|---|---|
| **Source** | ESPN scoreboard competitor `team.displayName`, `shortDisplayName`, `abbreviation`, mapped by `espnTeams()` (`src/lib/espn.ts`). Fallback: football-data.org `homeTeam`/`awayTeam` via `teamsFromMatches()` (`src/lib/footballData.ts`). Série C and Primera B come from committed files (`src/data/serie-c/2026.json`, `src/data/primera-b/2026.json`, read by `src/lib/firstParty.ts`). Cups come from ESPN cup scoreboards (`src/lib/cupData.ts`). |
| **Corrections / aliases** | `TEAM_OVERRIDES` in `src/config/teamOverrides.ts`: 218 entries, all matched by the provider's name string (case-insensitive), optionally scoped by league. None is matched by ID, although the type allows a football-data.org ID. Applied by `applyTeamOverrides()` in `loadEspn` and `loadLive`. |
| **EN/PT/ES** | Club names are **not localised**: one name per club in every language. Competitions are localised (`LeagueConfig.simulatorName`, messages); clubs are not. |
| **Slugs** | `withClubPages()` / `slugify()` in `src/lib/clubs.ts`, computed on every load from `team.name` after overrides (trailing "FC" dropped so ESPN and football-data.org agree). On a clash it appends the provider team ID (`<slug>-<id>`). Match slugs (`src/lib/matchSlug.ts`) are `<home-slug>-vs-<away-slug>-<local date>`, so they inherit this. |
| **Stored or live?** | Live. Fetched through Next's data cache (`keptEspn` in `src/lib/leagueData.ts`, kept up to 24 h with the refresh job on) and recomputed each load. The first-party leagues are stored in the repo. |
| **If ESPN disappears** | The cached copy serves until it expires (up to 24 h). After that, ISR keeps the last good pages but they never update. The 9 football-data.org leagues would load other names, and most slugs survive thanks to the "FC" rule, but not all (overrides are name-matched, so a different spelling slips through). The other 30 ESPN leagues, all cups and continental competitions have no source. |
| **If ESPN renames a club** | The slug changes, so every club and match URL for it changes: old URLs 404 (club) or redirect only by date proximity (match). An SEO regression with no warning. |
| **Smallest change** | A **club registry** in our store (§ Target architecture): one record per club with a FootSimu ID (= today's numeric ID), a **frozen slug** (= today's), name, short name, TLA, optional `names.pt` / `names.es`, colours and `providerIds`. Loads look clubs up by provider ID and take names and slugs from the registry; `slugify` only proposes a slug for a new club. `TEAM_OVERRIDES` folds into the registry and disappears. |

## 2. Badges / crests

| | Today |
|---|---|
| **Source** | ESPN `team.logo` URLs (`https://a.espncdn.com/i/teamlogos/soccer/500/<espnId>.png`), copied into `Team.crest` by `espnTeams()`. football-data.org crest URLs on its fallback. Fallbacks keyed by ESPN team ID in `CREST_FALLBACKS` (`src/config/crests.ts`, TheSportsDB artwork downloaded by `scripts/fetch-crests.mjs`). Cut-outs for crests with a background in `CREST_CUTOUTS` (`src/config/crestCutouts.ts`, `scripts/crest-backgrounds.ts`). Série C from the CBF, downloaded by `scripts/import-serie-c.ts`. Primera B from ESPN's CDN plus one image from `pbs.twimg.com`, downloaded by `scripts/import-primera-b.ts`. `TEAM_OVERRIDES.crest` can replace any. |
| **Hosted by us?** | Partly. 283 files (11 MB) under `public/crests/` (TheSportsDB fallbacks, `serie-c/`, `primera-b/`, `cutout/`) are ours. **Every other crest is hot-linked**: `TeamBadge` (`src/components/TeamBadge.tsx`) renders `<img src={team.crest}>` straight from `a.espncdn.com` in the visitor's browser, with no proxy and no `next/image`. |
| **Server-side fetches** | OG/share cards (`crestDataUri` in `src/lib/shareCard.tsx`, used by the club, match and share `opengraph-image` routes) fetch remote crests (2.5 s timeout, data cache 7 days) and our own via `ownCrest`. |
| **Existing fallback** | `TeamBadge` already draws a neutral disc with the TLA when a club has no crest, or when `NEXT_PUBLIC_SHOW_CRESTS=false`. Its colour is `HUES[team.id % 10]`, picked from the ESPN ID, not the club's colours. |
| **If ESPN disappears** | Most crests on the site break at once: broken images on every table, fixture list and match page, and OG cards fall back to initials. ESPN's CDN can also block hot-linking at any time, independently of the API. |
| **Smallest change** | Store colours in the club registry and render **self-generated neutral badges** (initials and colours, SVG, no image files). See § Neutral badges. As an interim kill switch, `NEXT_PUBLIC_SHOW_CRESTS=false` already removes every hot-link today with no code change; the discs would just not use club colours. |

## 3. Fixtures (dates, kick-off times, reschedules, postponements)

| | Today |
|---|---|
| **Source** | ESPN scoreboard for the whole season (`fetchEspnSeason` → `fetchEspnYear`: `/apis/site/v2/sports/soccer/<slug>/scoreboard?dates=<year>&limit=1000`, two calendar years for split seasons), mapped by `espnFixtures()`. Matchday numbers are **not published by ESPN**: `assignRounds()` rebuilds them heuristically from dates (median date of each club's n-th game, then Kempe-chain swaps). Postponed/cancelled games with a rescheduled twin are dropped by `dropReplacedPostponements()`. Venues come from `espnVenues()`. Stages, tournaments and post-season are split by ESPN season slugs (`EspnStages` in `src/config/leagues.ts`). football-data.org fallback: `/v4/competitions/<code>/matches` (one request per league). Cups: the ESPN cup scoreboard plus its round calendar (`loadEspnCupDraw` in `src/lib/cupData.ts`). |
| **Stored or live?** | Live, in the data cache (`keptEspn`, tag `league:<CODE>`), compared every 30 minutes by `/api/revalidate/leagues` (`src/lib/refreshRun.ts`, `src/lib/leagueRefresh.ts`). On match day the match page also reads the game's state for itself (`fetchEspnGameState` in `src/lib/matchPreview.ts`): hourly until an hour before kick-off, then every 10 minutes. Série C and Primera B are stored. |
| **Derived identifiers that depend on it** | `Fixture.id` = ESPN event ID. Round numbers come from `assignRounds`, so odds report URLs (`/odds/matchday-N`, `reportPath` in `src/lib/oddsReports.ts`) and snapshot `round`s rest on a heuristic over feed dates, not on a stored round. Match slugs use the date in the league's time zone. A game moved up to 21 days redirects (`MOVED_WITHIN_DAYS`). |
| **If ESPN disappears** | No new fixtures, reschedules or postponements for 39 leagues and every cup. The previously cached copy is shown until it expires, then frozen ISR pages remain. |
| **Smallest change** | Store each league-season's fixtures (FootSimu fixture ID, home/away club IDs, kick-off UTC, **stored matchday**, stage, venue, status, `providerIds`) as JSON. The importer only proposes changes (new kick-off, postponement, new fixture). Round numbers are frozen once stored, so report URLs can't drift. |

## 4. Results, scores and match status

| | Today |
|---|---|
| **Source** | The same ESPN season scoreboard. Final scores, shoot-outs (`shootoutScore`) and abandoned games whose score stands (`standingResults`, `EspnFeed.resultsStand`). On match day the match page reads live status (`espnGameState`: pre / in / post, off, score), and `settledGameState` keeps a final score for 6 h. Refresh-route small feed: `fetchEspnDays` (`scoreboard?dates=<from>-<to>&limit=300`, month fallback on HTTP 400) for leagues with a game near. football-data.org: `score.fullTime` and `status`. First-party: the committed files. |
| **Stored or live?** | Live, with data-cache copies. Settled match pages (>7 days) keep a frozen record in the data cache (`src/lib/settledMatch.ts`); that is a cache, not a store. |
| **Corrections** | No manual path except editing first-party files. A wrong ESPN score shows until ESPN fixes it. |
| **If ESPN disappears** | No new results anywhere but the two first-party leagues. Chances, outlooks and odds snapshots stop moving. |
| **Smallest change** | Results stored with the fixtures (score, penalties, status, `source: "espn" \| "football-data" \| "manual"`, imported-at). The importer writes results only for fixtures it can map, and **a manual override always wins**. Live in-play status on match day can stay as an optional, read-only importer call that never writes, or be dropped in favour of the 30-minute import (see Phase 4 trade-off). |

## 5. League tables

| | Today |
|---|---|
| **How** | **Computed by FootSimu**: `computeStandings()` (`src/engine/standings.ts`, 25 call sites in `src/lib` and `src/components`) from real results plus visitors' predictions, with each league's `tiebreakers` (`src/config/leagues.ts`: points, GD, goals for, head-to-head variants, away goals, fewer away goals against, seeded). Groups and conferences, split leagues and tournaments are handled in the engine. **Not copied from a feed.** |
| **What still comes from a provider** | Points **deductions**: ESPN standings `deductions` stat (`fetchEspnDeductions`, `/apis/v2/sports/soccer/<slug>/standings?season=<year>`), only for leagues with `espn.deductions` (Super League Greece and Peru's Liga 1). Every other league shows no deduction at all, even when one is applied in real life. **Group/conference membership**: the same standings endpoint (`fetchEspnGroups`, kept by `keptEspnGroups`). Série C: the CBF's official table is stored and used only for its card-based (discipline) tiebreak. Past Winners and quiz history are copied tables (see § 6). |
| **If ESPN disappears** | Tables keep computing from whatever results exist; deductions and groups stop updating (groups fall back for `groupsOptional` leagues, otherwise the load fails). |
| **Smallest change** | Store deductions and group membership per league-season next to the fixtures, editable through the override file. Nothing else needed: the table logic is already ours. |

## 6. xG and other provider data

| Data | Source | Stored? | Keyed by | If the provider disappears |
|---|---|---|---|---|
| xG per game | ESPN core API (`https://sports.core.api.espn.com/v2/sports/soccer/leagues/...`), `scripts/fetch-xg.ts`, daily in `odds-snapshots.yml` (06:41 UTC) for `XG_LEAGUES` (14 competitions) | Yes: `src/data/xg/<CODE>.json`, published and read at runtime via `publishedData` | ESPN event ID | No new xG. Only Série A and MLS use xG in ratings (`ratingXgWeight: 0.5`); they fall back to goals for new games. `withXg()` attaches xG only when `provider === "espn"`. |
| Priors (start-of-season ratings, rho, home splits) | ESPN results, `scripts/build-priors.ts`, run by hand once a season | Yes: `src/data/priors/<year>.ts` | ESPN team ID | Nothing until next season; a new season needs another source. Under the football-data.org fallback, **every club misses its prior** (different IDs) and gets `NO_DATA_PRIOR`. |
| Odds snapshots | Our simulation on ESPN data, `scripts/snapshot-odds.ts`, daily | Yes: `src/data/snapshots/<CODE>.json`, season key `"<CODE>:espn:<year>"` | ESPN team IDs, ESPN-derived rounds | No new snapshots or reports. The script **skips** non-ESPN data. |
| Quiz history | ESPN official standings, `scripts/build-history.ts`, by hand after a season | Yes: `src/data/history.json` | ESPN team IDs and names | Nothing until the next season's update. |
| Past Winners | Wikipedia (en/de/…), hand-built JSON under `src/data/history/*.json` with `source` and `retrievedAt` | Yes | Names | None. |
| Venues | ESPN `competitions[0].venue` (`espnVenues`) | No | ESPN event ID | Venue disappears from match pages. |
| Cup draws and rounds | ESPN cup scoreboards and calendar (`src/lib/cupData.ts`), data cache 1 h, tag `cup:<CODE>` | No | ESPN event and team IDs | Cups freeze. |
| Continental competitions | ESPN scoreboards (UCL, UEL, UECL, Libertadores, Sudamericana), not checked by the refresh job (daily via the safety net) | No | ESPN IDs | Freeze. |
| Club crests (fallbacks) | TheSportsDB (`scripts/fetch-crests.mjs`, free key `123`), offline | Yes, `public/crests/` | ESPN team ID | Nothing (already downloaded). |
| Série C | CBF (`cbf.com.br`, `conteudo.cbf.com.br` crests), `scripts/import-serie-c.ts`, one-off | Yes | **CBF club and game IDs** | Nothing. |
| Primera B | Spanish Wikipedia API (`es.wikipedia.org/w/api.php`), crests from ESPN CDN and one from `pbs.twimg.com`, `scripts/import-primera-b.ts`, by hand | Yes | **ESPN team IDs** (hand-listed) | Nothing (already stored). |

---

## Outside providers and endpoints

Frequencies are as configured on this `uat` (refresh job on, `LONGER_SAFETY_NET` and `SLOWER_IDLE_TURN` on).

| Provider / endpoint | Called from | When / how often | Leagues depending on it |
|---|---|---|---|
| ESPN site API, season scoreboard: `site.api.espn.com/apis/site/v2/sports/soccer/<slug>/scoreboard?dates=<year>&limit=1000` (4–6 MB) | `fetchEspnYear` / `fetchEspnSeason` via `keptEspn` (page renders, sitemap, build) and `freshLeagueData` (refresh route) | Kept in the data cache up to 24 h. The refresh route downloads it when a league has a game near and the small feed differs, or on the league's periodic turn (every 12th run = every 6 h). Also at every build. | 39 domestic leagues (all but Série C and Primera B) and 5 continental competitions |
| ESPN site API, small scoreboard: `…/scoreboard?dates=<from>-<to>&limit=300` (month fallback) | `fetchEspnDays`: refresh route (`refreshRun.ts`) and match pages (`fetchEspnGameState`) | Every 30 min per league with a game near (2 h before to 6 h after kick-off, 48 h if no result). Match pages: hourly on match day, every 10 min from an hour before kick-off, until final. | Same 39 leagues |
| ESPN standings: `site.api.espn.com/apis/v2/sports/soccer/<slug>/standings?season=<year>` | `fetchEspnDeductions`, `fetchEspnGroups`, `scripts/build-history.ts` | With each season load for leagues with `deductions` or `groups`; history by hand | Deductions: Super League Greece, Peru Liga 1. Groups/conferences: MLS, Liga Profesional (ARG), Primera Nacional, Libertadores, Sudamericana; optional (a later split): Greece, Austria, Ecuador. Quiz history: every league in it. |
| ESPN cup scoreboards (same endpoint, cup slugs) | `loadEspnCupDraw` (`cupData.ts`) | Data cache 1 h, on demand | FA Cup, EFL Cup, Copa do Brasil, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France, Copa Argentina |
| ESPN core API: `sports.core.api.espn.com/v2/sports/soccer/leagues/…` (xG) | `scripts/fetch-xg.ts` in `odds-snapshots.yml` | Daily, 06:41 UTC (GitHub Actions) | 14 `XG_LEAGUES` |
| ESPN CDN: `a.espncdn.com/i/teamlogos/soccer/500/<id>.png` | Visitors' browsers (`TeamBadge`), OG cards (`crestDataUri`), crest scripts | Every page view that shows a club (browser cache aside); OG cards cached 7 days | Every ESPN league, cup and continental competition, and Primera B's source crests |
| football-data.org v4: `api.football-data.org/v4/competitions/<code>/matches` | `loadLive` (`leagueData.ts`) | Only when ESPN fails **and** `FOOTBALL_DATA_API_KEY` is set; data cache 1 h. Free tier 10 req/min. | PL, Championship, La Liga, Bundesliga, Serie A, Ligue 1, Primeira Liga, Eredivisie, Brasileirão Série A (the 9 leagues without `espnOnly`) |
| GitHub raw: `raw.githubusercontent.com/JorgeHCamara/FootballSimulator/main/src/data/{snapshots,xg}/<CODE>.json` | `publishedData.ts` | Data cache up to 24 h; expired by the job's `publish` call | Every league with snapshots or xG (our own data, but an outside host) |
| TheSportsDB: `www.thesportsdb.com/api/v1/json/123` | `scripts/fetch-crests.mjs` | By hand | Fallback crests (lower-division cup clubs mostly) |
| CBF: `cbf.com.br`, `conteudo.cbf.com.br/clubes/<id>/escudo.jpg` | `scripts/import-serie-c.ts` | One-off | Série C |
| Wikipedia API: `es.wikipedia.org/w/api.php` | `scripts/import-primera-b.ts` | By hand | Primera B |
| X/Twitter image CDN: `pbs.twimg.com/profile_images/…` | `scripts/import-primera-b.ts` | By hand (one crest) | Primera B |

Scheduled jobs: `revalidate-leagues.yml` (`7,37 * * * *`), `odds-snapshots.yml` (`41 6 * * *`: xG and snapshots), `snapshot-drift.yml` (`23 5 * * *`), `ci.yml`. Out of scope here: share-intent links (X, Facebook, Reddit, WhatsApp) and AdSense, which are not data providers.

## Provider IDs leaking outside the import layer

| Where | What | Consequence of a provider switch |
|---|---|---|
| `Team.id` / `TeamId` (`src/engine/types.ts`) | ESPN team ID (football-data.org ID on fallback; CBF ID for Série C; ESPN ID for Primera B) | Everything below keys on it |
| `Fixture.id` / `FixtureId` | ESPN event ID (football-data.org match ID on fallback; CBF game ID for Série C) | Saved predictions, share links, xG, settled records, game-state lookups |
| `seasonKey` | `"<CODE>:espn:<year>"` for leagues with a fallback; `"<CODE>:<fd season id>"` on football-data.org | localStorage predictions (`src/store/simStore.ts`, `seasons[seasonKey]`), snapshots' season key |
| Share links (`src/lib/shareCodec.ts`) | Predictions encoded by **index in the fixture list sorted by ID** | A new ID set reorders the list, so old links decode onto the wrong games |
| `src/data/priors/<year>.ts` | `clubs` and `home` keyed by ESPN team ID | Fallback provider gets no priors (`NO_DATA_PRIOR` for all clubs) |
| `src/data/snapshots/*.json` | Teams keyed by ESPN team ID, season `<CODE>:espn:<year>`, rounds from `assignRounds` | Reports and movers stop matching |
| `src/data/xg/*.json` | ESPN event ID | xG not attached |
| `src/data/history.json` | ESPN team IDs and names | Quiz still works (names), but can't link clubs |
| `CREST_FALLBACKS`, `CREST_CUTOUTS` (`src/config/`) | ESPN team ID, and cut-outs keyed by the exact ESPN URL | Fallback crests lost |
| `public/crests/<espnId>.png`, `public/crests/cutout/<espnId>.png`, `primera-b/<espnId>.png`, `serie-c/<cbfId>.png` | File names | Cosmetic only |
| `TeamBadge` disc colour | `team.id % 10` | Disc colours change |
| Club slugs (`withClubPages`) | Provider name; provider ID appended on a clash | Possible URL changes (SEO) |
| Match slugs | Club slugs and date | Follow the club slugs |
| Data-cache keys and tags | `espnDataKey`, `keptLeagueKey` include parser version, not IDs | None |
| URLs | **No provider ID in any live URL today** (sitemap 27 Nov 2026: 702 club slugs, none with an ID suffix; the numbers seen are club names like `hannover-96`) | Safe today; one clash would add one |

## Target architecture

```
                    ┌─────────────── FootSimu store (git-backed JSON, published like snapshots/xG) ───────────────┐
                    │ src/data/clubs/<CODE>.json     club registry: id, slug (frozen), name, shortName, tla,        │
                    │                                names.pt?/names.es?, colours, crest?, providerIds{espn,fd,cbf} │
                    │ src/data/seasons/<CODE>/<year>.json   fixtures: id, matchday, kickoff, home, away, stage,     │
                    │                                status, result, penalties, venue, providerIds, source         │
                    │                                + deductions, groups                                           │
                    │ src/data/overrides/<CODE>.json  manual corrections (always win), with reason and date         │
                    └──────────────▲─────────────────────────────────────────────▲─────────────────────────────────┘
                                   │ writes (diff only)                          │ reads (data cache, tags)
            ┌──────────────────────┴───────────┐                     ┌───────────┴──────────────┐
            │ Import job (GitHub Actions)      │                     │ Site (Next, Vercel)      │
            │  Importer interface              │                     │  loadLeagueData(): store │
            │   ├─ EspnImporter                │                     │  + overrides → LeagueData│
            │   └─ FootballDataImporter        │                     │  (same shape as today)   │
            │  map provider IDs → FootSimu IDs │                     │  engine, 10,000 runs:    │
            │  unknown club/game → review list │                     │  unchanged               │
            └──────────────────────────────────┘                     └──────────────────────────┘
```

**Importer interface** (one small module, e.g. `src/import/`):

```ts
interface Importer {
  readonly provider: "espn" | "football-data";
  /** Whether it covers this league (ESPN slug, football-data.org code). */
  supports(league: LeagueConfig): boolean;
  /** The season's games as the provider has them (provider IDs, UTC kick-off, status, score). */
  fetchFixtures(league: LeagueConfig, season: number): Promise<ImportedGame[]>;
  /** Games around now only (the small feed): results, live status, kick-off moves. */
  fetchResults(league: LeagueConfig, from: Date, to: Date): Promise<ImportedGame[]>;
}

interface ImportedGame {
  providerGameId: string;
  homeProviderTeamId: string;
  awayProviderTeamId: string;
  kickoff: string;            // ISO UTC
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "abandoned";
  score?: { home: number; away: number };
  penalties?: { home: number; away: number };
  stage?: string;
  venue?: string;
}
```

- **Mapping:** clubs map through `providerIds` in the registry. Games map through `providerIds` on the stored fixture, or by (home, away, season, stage) when the provider ID is new. **An unmapped club or game is never auto-created on the site**: it goes to a review list in the job's output, and the import of that league is a no-op until it's mapped. This is what stops a feed rename from changing a URL.
- **Merge:** stored season, then importer changes (results, status, kick-off moves), then overrides on top, give the `LeagueData` the engine already takes. Tables, the 10,000-run Monte Carlo and every page stay as they are.
- **Manual override path:** `src/data/overrides/<CODE>.json` entries:
  - `{ fixtureId, result?, kickoff?, status?, reason, date }`
  - `{ clubId, deduction, reason }`
  - `{ clubId, name?, colours? }`

  A unit test validates every entry (club and fixture exist, scores are sane). An override is just a commit, so it has history and review for free.
- **Swappability:** ESPN and football-data.org both implement `Importer`. The job tries them in a configured order per league. Adding or replacing a provider is a new class plus `providerIds` for its clubs, with no page code touched.

## Phased plan (smallest safe steps first)

Effort is rough, for one developer who knows the codebase.

| # | Step | Effort | Behaviour change | Risks and guards |
|---|---|---|---|---|
| 0 | **Freeze identity.** A script exports today's clubs per league (ID, current slug, name, short name, TLA, crest URL, ESPN ID, football-data.org ID where `TEAM_OVERRIDES` or a one-off name match finds it) into `src/data/clubs/<CODE>.json`. Add a test that every live slug equals the registry slug. | 1–2 days | None | Run against live data, not sample. The test is the SEO guard for every later step. |
| 1 | **Registry drives names and slugs.** `loadEspn` / `loadLive` / first-party look clubs up by provider ID and take name, short name, TLA, slug and page from the registry. `slugify` is used only to propose a slug for an unknown club (logged). Fold `TEAM_OVERRIDES` into the registry. | 1–2 days | None visible; URLs frozen | Clubs promoted mid-season or new cup entrants: unknown clubs keep today's behaviour until added. EN/PT/ES parity: names stay one per club (optional `names.pt/es` later, never in slugs). |
| 2 | **Fix the fallback's IDs.** football-data.org teams and matches are mapped to FootSimu (= ESPN) IDs via the registry and fixture matching (home, away, date). `seasonKey` loses the `:espn:` dependency (keep the string as is for stored data). | 1–2 days | Fallback now keeps priors, predictions, share links, xG | Without it, step 5 can't be swappable. The free tier allows 10 req/min, so stay at one request per league. |
| 3 | **Neutral badges.** Add `colours` to the registry (seeded once, see below). `TeamBadge` and the OG cards draw an SVG badge (initials and colours) when `crest` is absent. Then stop reading `team.logo` (or flip `NEXT_PUBLIC_SHOW_CRESTS=false`) so nothing is hot-linked. | 2–3 days | Badges change look | Design review in light/dark; contrast check (WCAG AA for the initials); no layout shift (same sizes as `.crest-N`). OG cards get faster (no remote fetch). |
| 4 | **Stored seasons.** Export the current season of each ESPN league (fixtures with frozen matchday, results, status, deductions, groups) to `src/data/seasons/<CODE>/<year>.json`. The site reads the store first, through `publishedData` (data cache, tag per league) with the bundled file as fallback, exactly like snapshots and xG. ESPN is no longer read at render time. | 4–6 days | None visible; matchdays frozen | Store size: about 50–120 KB per league (like `keptEspn`), fine for GitHub raw and the data cache. Latency: GitHub raw serves a new file within about 5 minutes, on top of the 30-minute job. Live match-day status: either keep a read-only importer call on match pages (no store write, same cost as today), or accept 30-minute granularity. Recommend keeping it read-only first. |
| 5 | **Importer interface and import job.** Move `espn.ts` and `footballData.ts` behind `Importer`. The 30-minute `revalidate-leagues` job runs the importer (it already downloads the same data), writes the diff into the store, commits only when something changed, and calls the existing `publish` endpoint to expire just that league's tags. `scripts/vercel-ignore.mjs` already skips deploys for commits that touch only its `PUBLISHED_FOLDERS` (today `src/data/snapshots/` and `src/data/xg/`); add the new store folders there. | 4–6 days | None visible | Commit volume: only on real changes (results), roughly tens per matchday. If that's too noisy, commit to a dedicated `data` branch and point `FOOTSIMU_DATA_URL` at it. GitHub Actions minutes are free for a public repo. Job failure means stale data, not wrong data (same as today). |
| 6 | **Overrides.** `src/data/overrides/<CODE>.json` plus a validation test plus a short README section. Deductions and groups move here (from ESPN standings) as manual or importer-proposed entries. | 1–2 days | Corrections possible | Overrides must win over every importer run (test). |
| 7 | **Cups and continental competitions** through the same store and importer (draws as stored fixtures). | 3–5 days | None visible | Cup draws change often in a round; keep the hourly refresh of the draw for cups, or import hourly. |
| 8 | **Derived data on FootSimu IDs.** Nothing to migrate: FootSimu IDs equal today's ESPN IDs. New clubs and games get IDs from a FootSimu range (for example `>= 900000000`, or negative) so they can never collide with a future ESPN ID. `fetch-xg` and `build-priors` read through the importer and map IDs. | 1–2 days | None | Document the ID range. |

**Constraints checked against the plan**
- **SEO slugs and URLs never change:** slugs are frozen in step 0 and owned by the registry from step 1. Match slugs and `/odds/matchday-N` become stable because matchdays are stored (step 4).
- **EN/PT/ES parity:** the registry has one canonical name and optional `names.pt` / `names.es`. Slugs never come from translations, and messages are unaffected.
- **10,000 Monte Carlo runs:** the engine and `SCENARIO_ITERATIONS` are untouched, since `LeagueData` keeps its shape.
- **No extra Vercel cost:** renders read the store through the data cache, as they read ESPN today. That means fewer function-side 4–6 MB downloads, so less CPU and egress. The import runs on GitHub Actions. Tag expiry stays per league.
- **No paid services:** GitHub (public repo) and the existing data cache only. No database product, Vercel KV/Postgres or Blob is needed. A later move to a real database stays possible behind the same store reader.
- **Untouched:** About, Privacy, Contact, `ads.txt` and AdSense code are not involved in any step.

## Neutral badges (replacing third-party crests)

**Recommendation:** replace every third-party crest with a self-generated badge: the club's initials (the registry TLA, 2–3 letters) on a shape in the club's colours. Draw it as inline SVG by a `ClubBadge` component, server-rendered, so there's no image request and nothing hot-linked.

- **Why:** it removes the largest live dependency (ESPN's CDN on every page view) and any question over using clubs' trademarks or community artwork. It's also consistent across all 41 leagues, the cups and continental competitions, Série C and Primera B. The site already has the fallback disc (`TeamBadge`), so the change is about where colours come from, not a new concept.
- **Where colours are stored:** in the club registry, `src/data/clubs/<CODE>.json`:

  ```json
  { "id": 359, "slug": "arsenal", "name": "Arsenal", "shortName": "Arsenal", "tla": "ARS",
    "colours": { "primary": "#EF0107", "secondary": "#FFFFFF" },
    "providerIds": { "espn": "359", "footballData": 57 } }
  ```

  Text colour is computed (black or white by contrast against `primary`), not stored, so a bad pair can't be committed. A unit test checks every club has two valid hex colours and that the initials meet WCAG AA contrast.
- **Seeding colours once:** ESPN's team objects usually carry `color` / `alternateColor` hex fields, which the site doesn't read today (`EspnCompetitor.team` in `src/lib/espn.ts` doesn't type them; verify on a live response). A one-off script can read them into the registry. Clubs without them get colours sampled from the already self-hosted crests, or entered by hand. After that, colours are our data and are never re-imported automatically.
- **Design:**
  - A circle, or a simple shield outline drawn in SVG (a Lucide `shield` path is already in `src/components/Icon.tsx`).
  - Split diagonally or in halves: `primary` and `secondary`.
  - Initials in the site font.
  - Sizes from the existing `.crest-N` / `.disc-N` classes (no layout shift), with dark-mode borders so white-primary clubs stay visible.
- **OG/share cards:** draw the same SVG (Satori supports inline SVG), which removes `crestDataUri`'s remote fetches and their 2.5 s timeouts.
- **Rollout:**
  1. Flag it (reuse `NEXT_PUBLIC_SHOW_CRESTS`) and compare on the `uat` preview.
  2. Then remove `team.logo` from the import path, plus `CREST_FALLBACKS` / `CREST_CUTOUTS` and `public/crests/` (11 MB off every deployment's static files).
  3. Keep Série C / Primera B files only if the owner decides the CBF/ESPN crests should stay.
- **Trade-off:** less recognisable at a glance than real crests, especially for fans scanning a table. Club colours and TLA recover most of it. This is the owner's call; the store makes either choice a one-line switch.

## Open questions for the owner

1. Store location: commit imported data to `main` (simple, already how snapshots work), or to a separate `data` branch (cleaner history)?
2. Match-day live status: keep a read-only live call on match pages (today's freshness), or accept the 30-minute import granularity?
3. Localised club names (`names.pt`, `names.es`): wanted at all? Today none exist; adding them is optional and never touches slugs.
4. Neutral badges for every club, or keep self-hosted crests where FootSimu already holds them (Série C, Primera B, TheSportsDB fallbacks)?
5. Keep football-data.org as a second importer after step 2, or drop the `FOOTBALL_DATA_API_KEY` path?
