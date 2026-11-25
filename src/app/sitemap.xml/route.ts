import { sitemapIds, sitemapUrl } from "../../lib/sitemapIds.ts";

/*
 * The sitemap's index: the address robots.txt and Search Console know. It
 * lists the pieces (src/app/sitemaps/sitemap.ts), which depend only on the
 * site's leagues, so it's built once with the deployment.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapIds()
  .map((id) => `<sitemap>\n<loc>${sitemapUrl(id)}</loc>\n</sitemap>`)
  .join("\n")}
</sitemapindex>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}
