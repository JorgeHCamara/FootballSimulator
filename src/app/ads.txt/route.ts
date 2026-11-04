import { ADSENSE_CLIENT, adsTxt } from "../../lib/site.ts";

// Built once: the publisher id is a build-time setting.
export const dynamic = "force-static";

/** /ads.txt: authorises Google AdSense to sell the site's ad space; a 404 until a publisher id is set. */
export function GET() {
  if (!ADSENSE_CLIENT) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(adsTxt(ADSENSE_CLIENT), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
