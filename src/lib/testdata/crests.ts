// Checks on a cut-out crest (scripts/crest-backgrounds.ts), for the tests.

/** Share of a crest's outer shape (its silhouette, holes filled) that is transparent. */
export function seeThrough(rgba: Uint8Array, w: number, h: number): number {
  const clear = (p: number) => rgba[p * 4 + 3]! <= 40;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (outside[p] || !clear(p)) continue;
    outside[p] = 1;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  let inside = 0;
  let holes = 0;
  for (let p = 0; p < w * h; p++) {
    if (outside[p]) continue;
    inside++;
    if (clear(p)) holes++;
  }
  return holes / inside;
}

/** Alpha at a crest's four corners (all 0 once its background is cut away). */
export function cornerAlphas(rgba: Uint8Array, w: number, h: number): number[] {
  return [0, w - 1, (h - 1) * w, h * w - 1].map((p) => rgba[p * 4 + 3]!);
}
