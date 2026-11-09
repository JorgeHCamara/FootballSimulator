import { CARD_CACHE_HEADERS } from "./cardCache.ts";

/**
 * A card that can't fail: next/og draws while the response streams, so an
 * error (a crest it can't read) would only show then, as a broken image. Each
 * attempt is drawn in full first; the first that works is returned (200).
 * Any but the first is a stand-in (the initials, the branded card): it is
 * kept only briefly ("brief", see CardCache), so the proper card follows soon.
 */
export async function firstCardThatRenders(attempts: readonly (() => Promise<Response>)[]): Promise<Response> {
  for (const [i, attempt] of attempts.entries()) {
    try {
      const res = await attempt();
      const body = await res.arrayBuffer();
      if (res.ok && body.byteLength > 0) {
        const headers = new Headers(res.headers);
        if (i > 0) headers.set("Cache-Control", CARD_CACHE_HEADERS.brief["Cache-Control"]);
        return new Response(body, { status: 200, headers });
      }
    } catch (error) {
      console.warn("share card: falling back after", error);
    }
  }
  return new Response(null, { status: 500 });
}
