// The whole sitemap as one text: /sitemap.xml is an index (src/app/sitemap.xml/route.ts), each of its pieces
// fetched from the server under test (their addresses name the live site). `pieces`: each piece's address and text.
async function sitemapPieces(baseUrl) {
  const index = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
  const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!index.includes("<sitemapindex") || locs.length === 0) throw new Error(`/sitemap.xml isn't an index of sitemaps:\n${index.slice(0, 300)}`);
  return Promise.all(
    locs.map(async (loc) => {
      const res = await fetch(`${baseUrl}${new URL(loc).pathname}`);
      if (!res.ok) throw new Error(`${loc}: ${res.status}`);
      return { loc, text: await res.text() };
    }),
  );
}

async function fullSitemap(baseUrl) {
  return (await sitemapPieces(baseUrl)).map((p) => p.text).join("\n");
}

module.exports = { fullSitemap, sitemapPieces };
