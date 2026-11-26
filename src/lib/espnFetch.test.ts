import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESPN_TIMEOUT_MS, espnFetch } from "./espn.ts";

/** A fetch that answers after `ms` (or never), and gives up when its signal aborts, as the real one does. */
const slowFetch = (ms: number) => (async (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    // "Never" is ten seconds here: a timer the test's event loop waits on (AbortSignal.timeout's own doesn't keep it alive).
    const timer = setTimeout(() => resolve(new Response('{"events":[]}', { status: 200 })), ms === Infinity ? 10_000 : ms);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal!.reason);
    });
  })) as typeof fetch;

describe("ESPN requests from the refresh route: a time limit each", () => {
  it("about eight seconds", () => assert.equal(ESPN_TIMEOUT_MS, 8000));

  it("a request slower than its limit is given up (a TimeoutError), so the run goes on without it", async (t) => {
    t.mock.method(globalThis, "fetch", slowFetch(Infinity));
    const started = Date.now();
    await assert.rejects(espnFetch("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=2026", { cache: "no-store", timeoutMs: 50, perf: true }), (error: Error) => error.name === "TimeoutError");
    assert.ok(Date.now() - started < 2000);
  });

  it("each request gets its own limit, and an answer in time is handed on whole (perf: the body read first)", async (t) => {
    t.mock.method(globalThis, "fetch", slowFetch(20));
    for (let i = 0; i < 3; i++) {
      // Three requests of 20 ms under one 50 ms limit each: none is cut short by the time the ones before it took.
      const res = await espnFetch("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=2026", { timeoutMs: 50, perf: true });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { events: [] });
    }
  });

  it("without the options, a plain fetch: no signal added", async (t) => {
    const seen: (RequestInit | undefined)[] = [];
    t.mock.method(globalThis, "fetch", (async (_url: string, init?: RequestInit) => (seen.push(init), new Response("{}"))) as typeof fetch);
    await espnFetch("https://site.api.espn.com/x", { cache: "no-store" });
    assert.deepEqual(seen, [{ cache: "no-store" }]);
  });
});
