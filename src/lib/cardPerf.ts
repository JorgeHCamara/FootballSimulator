import { perfLog, since } from "./perfLog.ts";

/*
 * The [perf] line of a share card (an opengraph/twitter image or the movers
 * card): which card, its language and how long it took to draw. next/og draws
 * while the response streams, so the card is read in full here (as
 * firstCardThatRenders does) and handed on as it was: the time is the whole
 * drawing, not only the data loading before it.
 */

/** Which of CARD_CACHE_HEADERS a card went out with, from its s-maxage, for the log line. */
function keptFor(cacheControl: string | null): number | undefined {
  const sMaxAge = /s-maxage=(\d+)/.exec(cacheControl ?? "")?.[1];
  return sMaxAge === undefined ? undefined : Number(sMaxAge);
}

/** Draws a card (`draw`) and logs `[perf] {"op":"og-image","key":…,"route":…,"locale":…}`. The response is the card's. */
export async function timedCard(route: string, locale: string, key: string, draw: () => Promise<Response>): Promise<Response> {
  const start = performance.now();
  try {
    const res = await draw();
    const body = res.body ? await res.arrayBuffer() : null;
    perfLog({ op: "og-image", key, ms: since(start), cache: "miss", route, locale, status: res.status, kb: Math.round((body?.byteLength ?? 0) / 1024), sMaxAge: keptFor(res.headers.get("cache-control")) });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (error) {
    perfLog({ op: "og-image", key, ms: since(start), cache: "miss", route, locale, error: true });
    throw error;
  }
}
