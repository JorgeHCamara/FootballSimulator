import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdSlot } from "../components/AdSlot.ts";
import { AD_SIZES, adMode, adsConfig, pushAd, type AdsConfig } from "./adSlots.ts";
import { ADSENSE_CLIENT, adsenseClient, adsTxt } from "./site.ts";

const CLIENT = "ca-pub-1234567890123456";
const off = adsConfig({});
const live = adsConfig({ NEXT_PUBLIC_ADS_SLOTS: "1", NEXT_PUBLIC_ADSENSE_CLIENT: CLIENT, NEXT_PUBLIC_ADS_UNIT_IN_CONTENT: "1234567890", NEXT_PUBLIC_ADS_UNIT_RAIL: "2345678901" });
const render = (config: AdsConfig, kind: "inContent" | "rail" = "inContent") => renderToStaticMarkup(createElement(AdSlot, { kind, config }));

describe("ad slots", () => {
  it("off by default: no setting, no slot", () => {
    assert.deepEqual(off, { slots: false, debug: false, units: {} });
    assert.equal(adsConfig().slots, process.env.NEXT_PUBLIC_ADS_SLOTS === "1", "read from the environment");
    assert.equal(adMode("inContent", off), "off");
    assert.equal(adMode("rail", off), "off");
    // A publisher id alone (Auto ads, as today) doesn't turn the slots on.
    assert.equal(adMode("inContent", adsConfig({ NEXT_PUBLIC_ADSENSE_CLIENT: CLIENT, NEXT_PUBLIC_ADS_UNIT_IN_CONTENT: "1234567890" })), "off");
  });

  it("flag off: renders nothing (no box, no <ins>, no script, no push)", () => {
    assert.equal(render(off), "");
    assert.equal(render(off, "rail"), "");
  });

  it("flag on: the box at its ad's exact size, holding its ad unit with the publisher id and the unit", () => {
    assert.equal(adMode("inContent", live), "live");
    const html = render(live);
    assert.match(html, /data-testid="ad-slot"[^>]*data-ad-kind="inContent"[^>]*data-ad-mode="live"/);
    // 300×250 on phones, 728×90 from md up: the reserved size is the ad's.
    assert.deepEqual(AD_SIZES.inContent, { mobile: [300, 250], desktop: [728, 90] });
    assert.match(html, /<div class="relative shrink-0 h-\[250px\] w-\[300px\] md:h-\[90px\] md:w-\[728px\]" data-testid="ad-box">/);
    assert.match(html, /<ins class="adsbygoogle block h-\[250px\] w-\[300px\] md:h-\[90px\] md:w-\[728px\]" data-ad-client="ca-pub-1234567890123456" data-ad-slot="1234567890"/);
    assert.equal((html.match(/<ins/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script/i, "no script of its own: the layout's Auto ads script fills it");
    assert.doesNotMatch(html, />Ad</, "no label without the debug flag");
    // The rail: 300×600, wide desktops only.
    assert.deepEqual(AD_SIZES.rail, { desktop: [300, 600] });
    assert.match(render(live, "rail"), /class="relative shrink-0 hidden h-\[600px\] w-\[300px\] lg:block"/);
  });

  it("flag on without a publisher id or an ad unit: the empty box only, kept out of the accessibility tree", () => {
    for (const config of [adsConfig({ NEXT_PUBLIC_ADS_SLOTS: "1" }), adsConfig({ NEXT_PUBLIC_ADS_SLOTS: "1", NEXT_PUBLIC_ADSENSE_CLIENT: CLIENT })]) {
      assert.equal(adMode("inContent", config), "reserved");
      const html = render(config);
      assert.match(html, /data-ad-mode="reserved"/);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /h-\[250px\] w-\[300px\] md:h-\[90px\] md:w-\[728px\]/);
      assert.doesNotMatch(html, /<ins|<script/);
    }
    // Ids that aren't AdSense's are ignored (the site's own helper for the publisher id).
    const bad = adsConfig({ NEXT_PUBLIC_ADS_SLOTS: "1", NEXT_PUBLIC_ADSENSE_CLIENT: "pub-123", NEXT_PUBLIC_ADS_UNIT_IN_CONTENT: "abc" });
    assert.deepEqual(bad, { slots: true, debug: false, units: {} });
  });

  it("the debug flag: the box labelled \"Ad\", with or without an ad", () => {
    const debug = adsConfig({ NEXT_PUBLIC_ADS_DEBUG: "1" });
    assert.equal(adMode("inContent", debug), "debug");
    const html = render(debug);
    assert.match(html, /data-ad-mode="debug"/);
    assert.match(html, />Ad<\/span>/);
    assert.match(html, /border-dashed/);
    assert.doesNotMatch(html, /<ins/);
    assert.match(render({ ...live, debug: true }), /<ins/);
    assert.match(render({ ...live, debug: true }), />Ad<\/span>/);
  });

  it("filling a unit: one adsbygoogle.push per unit, onto the queue the AdSense script reads", () => {
    const page: { adsbygoogle?: unknown[] } = {};
    pushAd(page);
    assert.deepEqual(page.adsbygoogle, [{}]);
    pushAd(page);
    assert.equal(page.adsbygoogle!.length, 2);
    // Server rendering never asks (the request is made in the browser, once the unit is on the page).
    const queue: unknown[] = [];
    (globalThis as { adsbygoogle?: unknown[] }).adsbygoogle = queue;
    render(live);
    assert.equal(queue.length, 0);
    delete (globalThis as { adsbygoogle?: unknown[] }).adsbygoogle;
  });

  it("no script tags of their own, and the AdSense helpers, ads.txt and the layout's script as they were", () => {
    for (const file of ["../components/AdSlot.ts", "../components/AdUnit.ts", "./adSlots.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /next\/script|createElement\(\s*["']script|adsbygoogle\.js|<script/i, file);
    }
    assert.equal(adsenseClient(CLIENT), CLIENT);
    assert.equal(adsTxt(CLIENT), "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    assert.equal(ADSENSE_CLIENT, adsenseClient(process.env.NEXT_PUBLIC_ADSENSE_CLIENT));
  });
});
