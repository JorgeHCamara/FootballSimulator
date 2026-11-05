/**
 * A card that can't fail: next/og draws while the response streams, so an
 * error (a crest it can't read) would only show then, as a broken image. Each
 * attempt is drawn in full first; the first that works is returned (200).
 */
export async function firstCardThatRenders(attempts: readonly (() => Promise<Response>)[]): Promise<Response> {
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      const body = await res.arrayBuffer();
      if (res.ok && body.byteLength > 0) return new Response(body, { status: 200, headers: res.headers });
    } catch (error) {
      console.warn("share card: falling back after", error);
    }
  }
  return new Response(null, { status: 500 });
}
