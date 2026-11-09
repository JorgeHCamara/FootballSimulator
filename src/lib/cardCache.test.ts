import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_CACHE_HEADERS, crestsDrawn } from "./cardCache.ts";
import { firstCardThatRenders } from "./cardFallback.ts";

const maxAge = (header: string | null, key: "max-age" | "s-maxage") => Number(new RegExp(`(?:^|[ ,])${key}=(\\d+)`).exec(header ?? "")?.[1]);
const card = (cache: keyof typeof CARD_CACHE_HEADERS) => async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png", ...CARD_CACHE_HEADERS[cache] } });
const broken = async (): Promise<Response> => {
  throw new Error("can't draw");
};

describe("share cards: how long they're kept", () => {
  it("keeps a card that can't change far longer than a live one, and a stand-in briefly", () => {
    const cdn = (cache: keyof typeof CARD_CACHE_HEADERS) => maxAge(CARD_CACHE_HEADERS[cache]["Cache-Control"], "s-maxage");
    assert.equal(cdn("final"), 31536000);
    assert.equal(cdn("live"), 3600);
    assert.equal(cdn("brief"), 300);
    for (const cache of ["final", "live", "brief"] as const) assert.match(CARD_CACHE_HEADERS[cache]["Cache-Control"], /^public, /);
  });

  it("counts a card's crests as drawn only when every one asked for is on it", () => {
    assert.equal(crestsDrawn([]), true);
    assert.equal(crestsDrawn([["https://a/1.png", "data:image/png;base64,AA"]]), true);
    // A club without a crest has nothing to miss.
    assert.equal(crestsDrawn([[undefined, undefined], ["https://a/1.png", "data:image/png;base64,AA"]]), true);
    assert.equal(crestsDrawn([["https://a/1.png", "data:image/png;base64,AA"], ["https://a/2.png", undefined]]), false);
  });

  it("returns the first card as it is, and any fallback as a stand-in, kept briefly", async () => {
    const first = await firstCardThatRenders([card("final"), card("live")]);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("Cache-Control"), CARD_CACHE_HEADERS.final["Cache-Control"]);
    assert.equal(first.headers.get("Content-Type"), "image/png");
    assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1, 2, 3]);

    const fallback = await firstCardThatRenders([broken, card("final")]);
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("Cache-Control"), CARD_CACHE_HEADERS.brief["Cache-Control"]);
    assert.equal(fallback.headers.get("Content-Type"), "image/png");

    const empty = async () => new Response(new Uint8Array(), { headers: CARD_CACHE_HEADERS.final });
    const afterEmpty = await firstCardThatRenders([empty, card("live")]);
    assert.equal(afterEmpty.headers.get("Cache-Control"), CARD_CACHE_HEADERS.brief["Cache-Control"]);

    assert.equal((await firstCardThatRenders([broken])).status, 500);
  });
});
