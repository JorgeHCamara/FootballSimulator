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
| `FOOTBALL_DATA_API_KEY` | Your free key from https://www.football-data.org/client/register. Without it the site shows generated sample leagues. |
| `NEXT_PUBLIC_SITE_URL` | `https://footsimu.com` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Added in step 7 |

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

- `https://footsimu.com` redirects to your language (for example `/pt` on a Portuguese browser).
- League pages show real teams, with no "Sample data" banner.
- `https://footsimu.com/sitemap.xml` and `/robots.txt` list footsimu.com URLs.
- Pasting a league link into WhatsApp or X shows the preview image.

## 7. Google Search Console

1. Go to https://search.google.com/search-console → **Add property** → **URL prefix** → `https://footsimu.com`.
2. Choose the **HTML tag** method. Copy only the `content="…"` value into `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, then redeploy.
3. Click **Verify**, then open **Sitemaps** and submit `https://footsimu.com/sitemap.xml`.
4. Optional: do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters), which can import directly from Search Console.

## Day to day

- Make changes on a branch and open a pull request. Vercel posts a preview link on it.
- Merging into `main` deploys to footsimu.com.
- If a deploy breaks something, use **Deployments → … → Promote to Production** on the previous deploy to roll back instantly.

## Limits to keep in mind

- **Data API usage:** data is cached for an hour, so the site makes about a dozen football-data.org requests per hour. That is far below the free tier's 10 requests per minute.
- **Commercial use:** football-data.org's free tier is for non-commercial use. If Foot Simu starts making money, check their paid plans.
