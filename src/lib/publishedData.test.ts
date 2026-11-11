import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dataVersion } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";
import { snapshotsStamp } from "./oddsReports.ts";
import { DEFAULT_DATA_URL, fetchPublishedText, fresher, parsePublications, publicationState, publishedSource, publishedTag, publishedUrl, readPublished, sha256 } from "./publishedData.ts";
import type { LeagueSnapshots, OddsSnapshot } from "./snapshots.ts";
import { xgStamp } from "./xgStore.ts";

const respond = (status: number, body = "") => (async () => new Response(status === 404 ? null : body, { status })) as unknown as typeof fetch;

describe("where the published data is read from", () => {
  it("main's files on GitHub when running on Vercel; nowhere off it, with sample data, or when turned off", () => {
    assert.deepEqual(publishedSource({ VERCEL: "1" }), { base: DEFAULT_DATA_URL });
    assert.equal(publishedSource({}), undefined, "a local build, the tests, the scripts: the files on disk");
    assert.equal(publishedSource({ VERCEL: "1", FOOTSIMU_SAMPLE_DATA: "1" }), undefined);
    assert.equal(publishedSource({ VERCEL: "1", FOOTSIMU_DATA_URL: "off" }), undefined);
    assert.deepEqual(publishedSource({ FOOTSIMU_DATA_URL: "https://example.org/data/" }), { base: "https://example.org/data" });
    assert.deepEqual(publishedSource({ VERCEL: "1", FOOTSIMU_DATA_TOKEN: "t" }), { base: DEFAULT_DATA_URL, token: "t" });
    assert.equal(publishedSource({ FOOTSIMU_DATA_URL: "ftp://nope" }), undefined);
  });

  it("each file by its own address and tag: one league's publication touches no other", () => {
    assert.equal(publishedUrl({ base: DEFAULT_DATA_URL }, "snapshots", "PL"), `${DEFAULT_DATA_URL}/src/data/snapshots/PL.json`);
    assert.equal(publishedUrl({ base: DEFAULT_DATA_URL }, "xg", "BSA"), `${DEFAULT_DATA_URL}/src/data/xg/BSA.json`);
    assert.equal(publishedTag("snapshots", "PL"), "published:snapshots:PL");
    assert.notEqual(publishedTag("snapshots", "PL"), publishedTag("xg", "PL"));
    assert.notEqual(publishedTag("snapshots", "PL"), publishedTag("snapshots", "PD"));
  });

  it("a file's text, null for a league without one, an error when the source fails; only league codes are asked for", async () => {
    const source = { base: "https://example.org" };
    assert.equal(await fetchPublishedText(source, "xg", "PL", respond(200, "{}")), "{}");
    assert.equal(await fetchPublishedText(source, "xg", "PL", respond(404)), null);
    await assert.rejects(fetchPublishedText(source, "xg", "PL", respond(503)));
    await assert.rejects(fetchPublishedText(source, "xg", "../../etc", respond(200, "{}")));
  });

  it("no source: the caller is told to use the deployment's own files, and nothing is fetched", async () => {
    assert.equal(await readPublished("snapshots", "PL", { env: {} }), undefined);
    assert.equal(await readPublished("snapshots", "PL", { env: { VERCEL: "1", FOOTSIMU_SAMPLE_DATA: "1" } }), undefined);
  });
});

describe("what the job announces", () => {
  const sha = "a".repeat(64);

  it("the files and their fingerprints; anything else is left out", () => {
    assert.deepEqual(parsePublications(`snapshots:PL:${sha},xg:pl,xg:BSA:${sha}`), [
      { kind: "snapshots", code: "PL", sha },
      { kind: "xg", code: "PL" },
      { kind: "xg", code: "BSA", sha },
    ]);
    assert.deepEqual(parsePublications("priors:PL,snapshots:../x,snapshots:PL:nothex,,xg"), []);
  });

  it("published once the source serves that version; pending while it serves the last one; unavailable when it can't be read", async () => {
    const source = { base: "https://example.org" };
    const text = '{"league":"PL","matches":{}}\n';
    assert.equal(await publicationState({ kind: "xg", code: "PL", sha: sha256(text) }, source, respond(200, text)), "published");
    assert.equal(await publicationState({ kind: "xg", code: "PL", sha: sha256(text) }, source, respond(200, "{}")), "pending", "GitHub's CDN still has the old file");
    assert.equal(await publicationState({ kind: "xg", code: "PL", sha: sha256(text) }, source, respond(404)), "pending");
    assert.equal(await publicationState({ kind: "xg", code: "PL", sha: sha256(text) }, source, respond(500)), "unavailable");
    // Nothing to check against, or nowhere to check: taken as published (the tags are expired; the deployment reads its own files).
    assert.equal(await publicationState({ kind: "xg", code: "PL" }, source, respond(500)), "published");
    assert.equal(await publicationState({ kind: "xg", code: "PL", sha }, undefined, respond(500)), "published");
    // sha256sum's fingerprint.
    assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the published file against the deployment's own", () => {
  const snapshot = (round: number, takenAt: string) => ({ round, takenAt }) as OddsSnapshot;
  const file = (...snapshots: OddsSnapshot[]): LeagueSnapshots => ({ league: "PL", seasons: { "PL:espn:2026": { season: "2026/27", snapshots } } });

  it("snapshots: the one taken last wins, so a new round is read with no deployment, and a deployment with retaken rounds isn't undone", () => {
    const built = file(snapshot(10, "2026-11-03T06:45:00.000Z"));
    const published = file(snapshot(10, "2026-11-03T06:45:00.000Z"), snapshot(11, "2026-11-10T06:45:00.000Z"));
    assert.equal(fresher(built, published, snapshotsStamp), published, "the round the job published last night");
    assert.equal(fresher(built, built, snapshotsStamp), built);
    const retaken = file(snapshot(10, "2026-11-12T09:00:00.000Z"), snapshot(11, "2026-11-12T09:00:01.000Z"));
    assert.equal(fresher(retaken, published, snapshotsStamp), retaken, "rebuilt with a new model and deployed: the source catches up within minutes");
    assert.equal(fresher(built, undefined, snapshotsStamp), built, "GitHub can't be read");
    assert.equal(fresher(built, null, snapshotsStamp), built, "no such file at the source");
    assert.equal(fresher(undefined, published, snapshotsStamp), published, "a league whose first snapshot came after the deployment");
    assert.equal(fresher(undefined, undefined, snapshotsStamp), undefined);
  });

  it("xG: the file with more games' xG wins (the files only grow)", () => {
    const built = { league: "PL" as const, matches: { "1": [1.2, 0.8] as const, "2": null } };
    const published = { league: "PL" as const, matches: { "1": [1.2, 0.8] as const, "2": [0.4, 2.1] as const } };
    assert.ok(xgStamp(published) > xgStamp(built), "a game's xG that arrived late");
    assert.ok(xgStamp({ league: "PL", matches: { ...built.matches, "3": null } }) > xgStamp(built), "a new game, no xG yet");
    assert.equal(fresher(built, published, xgStamp), published);
    assert.equal(fresher(published, built, xgStamp), published);
  });
});

describe("new xG and the shared season run", () => {
  const fixtures = [
    { id: 1, matchday: 1, utcDate: "2026-08-15T14:00Z", homeId: 1, awayId: 2, result: { home: 2, away: 1 } },
    { id: 2, matchday: 1, utcDate: "2026-08-15T16:30Z", homeId: 3, awayId: 4, result: { home: 0, away: 0 } },
  ];
  const data = (xg?: LeagueData["xg"]): LeagueData => ({ teams: [], fixtures, season: "2026/27", seasonKey: "PL:espn:2026", source: "live", provider: "espn", ...(xg ? { xg } : {}) });

  it("the run's key (dataVersion) changes with the xG the ratings use, so new xG starts a new run and nothing has to be expired by hand", () => {
    const before = dataVersion(data({ 1: [1.4, 0.9] }));
    assert.notEqual(dataVersion(data({ 1: [1.4, 0.9], 2: [0.3, 0.6] })), before, "another game's xG published");
    assert.notEqual(dataVersion(data({ 1: [1.5, 0.9] })), before, "a corrected value");
    assert.equal(dataVersion(data({ 1: [1.4, 0.9] })), before, "the same xG, the same run");
    assert.equal(dataVersion(data({ 2: [0.3, 0.6], 1: [1.4, 0.9] })), dataVersion(data({ 1: [1.4, 0.9], 2: [0.3, 0.6] })), "whatever order it's stored in");
  });

  it("a league whose ratings use no xG keeps the key it had before xG counted", () => {
    assert.equal(dataVersion(data()), dataVersion(data({})));
    // FNV-1a over the games and groups alone, as before this change.
    let hash = 0x811c9dc5;
    for (const f of fixtures) for (const ch of `${f.id}@${f.utcDate}=${f.result.home}-${f.result.away};`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    assert.equal(dataVersion(data()), `PL:espn:2026:2:${hash.toString(36)}`);
  });
});
