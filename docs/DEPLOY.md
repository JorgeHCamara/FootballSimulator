# Deploying Foot Simu to footsimu.com

Foot Simu is hosted on [Vercel](https://vercel.com), the platform built by the Next.js team. It supports everything the app uses with no extra configuration:
- pre-rendered pages that refresh every hour
- generated share images
- language redirects

HTTPS, a global CDN and a preview link for every pull request are included.

**Plans:** the free Hobby plan is for non-commercial use. Switch to Pro (about $20/month) once the site shows ads or earns money.

## 1. Prepare the GitHub repository

Production deploys from the `main` branch. In GitHub → **Settings → General → Default branch**, choose `main`.

## 2. Buy the domain

Buy `footsimu.com` at [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (sold at cost) or directly in Vercel (**Domains → Buy**).

## 3. Create the Vercel project

1. Sign up at vercel.com with your GitHub account.
2. **Add New → Project** → import `JorgeHCamara/FootballSimulator`.
3. Framework: **Next.js** (detected automatically). Leave the build settings at their defaults.
4. In **Settings → Build and Deployment**, set Node.js to **22.x**, and make sure the production branch is `main`.

## 4. Environment variables

In **Settings → Environment Variables**, add these for *Production* and *Preview*:

| Name | Value |
|---|---|
| `FOOTBALL_DATA_API_KEY` | Your free key from https://www.football-data.org/client/register. Optional: the fallback source when ESPN's public feed (the main source) fails. |
| `NEXT_PUBLIC_SITE_URL` | `https://footsimu.com` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Added in step 7 |
| `REVALIDATE_TOKEN` | Optional: a long random string (e.g. `openssl rand -hex 32`). With it, and the same value as the GitHub repository secret `REVALIDATE_TOKEN`, a scheduled job refreshes a league's page and all its club pages together when new results come in (see "Shared outlook" in the README). Production only. |

Ad slots (see "Ad slots" in the README) stay off unless these are set, after the AdSense review and alongside `NEXT_PUBLIC_ADSENSE_CLIENT`:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_ADS_SLOTS` | `1` turns the reserved ad slots on (off when unset). |
| `NEXT_PUBLIC_ADS_UNIT_IN_CONTENT` | The AdSense ad unit id (digits) for the slots in the pages. |
| `NEXT_PUBLIC_ADS_UNIT_RAIL` | The ad unit id for a desktop rail (none is placed yet). |
| `NEXT_PUBLIC_ADS_DEBUG` | `1` shows each slot's box labelled "Ad", to check the layout on a preview. |

Redeploy after changing variables: **Deployments → … → Redeploy**.

## 5. Connect footsimu.com

1. **Settings → Domains** → add `footsimu.com`, then add `www.footsimu.com` and set it to **redirect to footsimu.com** (308).
2. At your registrar, create the DNS records Vercel shows. Usually:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com` |

   On Cloudflare, set these records to **DNS only** (grey cloud) so Vercel can issue the certificate.
3. Wait for Vercel to show the domain as **Valid**. HTTPS is set up automatically, usually within minutes.

## 6. Check the live site

- **footsimu.com must be the primary domain.** `https://footsimu.com/pt` should load directly, and `https://www.footsimu.com/pt` should redirect (308) to it. If it's the other way round, Google sees every page's canonical address pointing at a redirect and may not index the site. Fix it under **Settings → Domains**: `footsimu.com` with no redirect, `www.footsimu.com` redirecting to `footsimu.com`. Check with `curl -I https://footsimu.com/pt` (expect `200`) and `curl -I https://www.footsimu.com/pt` (expect `308`).
- `https://footsimu.com` redirects to your language (for example `/pt` on a Portuguese browser).
- League pages show real teams.
- `https://footsimu.com/sitemap.xml` and `/robots.txt` list footsimu.com URLs.
- Pasting a league link into WhatsApp or X shows the preview image.

## 7. Google Search Console

footsimu.com is verified as a **URL prefix** property (`https://footsimu.com`) with the **HTML tag** method, and its sitemap is submitted.

- The verification code is in `src/lib/site.ts` (`GOOGLE_SITE_VERIFICATION`) and is added to every page. **Don't remove it**: Google re-checks the tag and the property would lose its verification.
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` is only needed to override it, for example when deploying to another domain.

To set it up again from scratch:

1. Go to https://search.google.com/search-console → **Add property** → **URL prefix** → `https://footsimu.com`.
2. Choose the **HTML tag** method and put the `content="…"` value in `GOOGLE_SITE_VERIFICATION` (or the env var), then deploy.
3. Click **Verify**, then open **Sitemaps** and submit `https://footsimu.com/sitemap.xml`.
4. Speed up the first crawl: **URL Inspection** → paste `https://footsimu.com/pt` → **Request indexing**. Repeat for `/en`, `/pt/brasileirao` and `/en/premier-league`.
5. Expect brand searches ("foot simu") to show the site within days of indexing, league searches ("simulador série b") within weeks, and broad terms ("football simulator") only over time and with links from other sites. Search Console's **Pages** and **Performance** reports show the progress.
6. Optional: do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters), which can import directly from Search Console.

## Day to day

- Make changes on a branch and open a pull request. Vercel posts a preview link on it.
- Merging into `main` deploys to footsimu.com.
- If a deploy breaks something, use **Deployments → … → Promote to Production** on the previous deploy to roll back instantly.

## Limits to keep in mind

- **Data API usage:** data is cached for an hour, so the site makes about a dozen football-data.org requests per hour. That is far below the free tier's 10 requests per minute.
- **Commercial use:** football-data.org's free tier is for non-commercial use. If Foot Simu starts making money, check their paid plans.
