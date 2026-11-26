import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBot, PERF_LINE_MAX, perfLine, perfLog } from "./perfLog.ts";

describe("the [perf] log line", () => {
  it("is JSON with op, key, ms and cache first, then the extras", () => {
    const line = perfLine({ op: "match-impact", key: "premier-league/a-vs-b-2026-12-05", ms: 12.6, cache: "miss", locale: "pt", far: true });
    assert.deepEqual(JSON.parse(line), { op: "match-impact", key: "premier-league/a-vs-b-2026-12-05", ms: 13, cache: "miss", locale: "pt", far: true });
    assert.ok(line.startsWith('{"op":"match-impact","key":'));
  });

  it("leaves out undefined extras", () => {
    assert.deepEqual(JSON.parse(perfLine({ op: "x", key: "k", ms: 1, cache: "hit", simMs: undefined })), { op: "x", key: "k", ms: 1, cache: "hit" });
  });

  it(`stays under ${PERF_LINE_MAX} bytes, prefix included, however long the key or the extras`, () => {
    const long = "x".repeat(1000);
    const line = perfLine({ op: "og-image", key: long, ms: 1, cache: "miss", a: long, b: long, route: "match" });
    assert.ok(Buffer.byteLength(`[perf] ${line}`) < PERF_LINE_MAX, `${Buffer.byteLength(line)} bytes`);
    const parsed = JSON.parse(line);
    assert.equal(parsed.op, "og-image");
    assert.ok(parsed.key.length <= 121);
    // A path from a crawler, with characters JSON escapes.
    const odd = perfLine({ op: "not-a-locale", key: `/${'"\\\n'.repeat(200)}`, ms: 0, cache: "miss", status: 404 });
    assert.ok(Buffer.byteLength(`[perf] ${odd}`) < PERF_LINE_MAX);
    assert.equal(JSON.parse(odd).op, "not-a-locale");
  });

  it("logs nothing outside Next (scripts, tests), and one console.info line inside it", (t) => {
    const info = t.mock.method(console, "info", () => {});
    perfLog({ op: "x", key: "k", ms: 1, cache: "hit" });
    assert.equal(info.mock.callCount(), 0);
    perfLog({ op: "x", key: "k", ms: 1, cache: "hit" }, true);
    assert.equal(info.mock.callCount(), 1);
    assert.deepEqual(info.mock.calls[0]!.arguments, ["[perf]", '{"op":"x","key":"k","ms":1,"cache":"hit"}']);
  });

  it("flags bots coarsely from the user agent, and nothing else", () => {
    assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
    assert.equal(isBot("facebookexternalhit/1.1"), true);
    assert.equal(isBot("curl/8.5.0"), true);
    assert.equal(isBot(null), true);
    assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), false);
  });
});
