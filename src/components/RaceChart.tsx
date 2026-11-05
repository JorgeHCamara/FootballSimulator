"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface RaceSeries {
  /** Shown in the legend, labels, tooltip and table. */
  name: string;
  /** A chance (0–1) after each round. */
  values: number[];
}

interface Props {
  rounds: number[];
  /** At most five, in the order of the categorical slots (the leader first). */
  series: RaceSeries[];
  locale: string;
  /** Rounds whose chances were the first of a new model: the step into each is the model's, not the results'. */
  modelChanges?: readonly number[];
  labels: { round: string; table: string; caption: string; modelChange?: string };
}

/*
 * Colours: the first five categorical slots of the dataviz reference palette,
 * validated on this chart's surfaces (white, zinc-900): adjacent pairs clear
 * the colour-blind and normal-vision floors in both modes. Three light slots
 * are under 3:1 on white, so every line also has a visible label (or the
 * legend and table on phones).
 */
const STYLE = `
.race-chart { --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --grid:#e4e4e7; --axis:#71717a; --surface:#ffffff; }
@media (prefers-color-scheme: dark) {
  .race-chart { --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --grid:#3f3f46; --axis:#a1a1aa; --surface:#18181b; }
}`;

const color = (i: number) => `var(--s${i + 1})`;
const HEIGHT = 240;
const PAD = { top: 12, bottom: 28, left: 38 };

/**
 * A line per club across the season's rounds: hover (or touch) shows every
 * club's chance at that round; a table view below has the same numbers.
 */
export function RaceChart({ rounds, series, locale, modelChanges = [], labels }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry!.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pct = useMemo(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }), [locale]);
  const show = (v: number) => (v > 0 && v < 0.005 ? `<${pct.format(0.01)}` : pct.format(v));
  // Phones: no end labels (the legend, the tooltip and the table carry the names).
  const endLabels = width >= 480;
  const right = endLabels ? 118 : 12;
  const max = Math.min(1, Math.max(0.2, Math.ceil(Math.max(...series.flatMap((s) => s.values), 0) * 5) / 5));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const plotW = width - PAD.left - right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (rounds.length === 1 ? plotW / 2 : (i / (rounds.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const last = rounds.length - 1;

  // End labels, kept 14px apart (a leader line joins a moved label to its line).
  const ends = series
    .map((s, i) => ({ i, y: y(s.values[last] ?? 0) }))
    .sort((a, b) => a.y - b.y)
    .reduce<{ i: number; y: number; at: number }[]>((out, e) => [...out, { ...e, at: Math.max(e.y, (out.at(-1)?.at ?? -Infinity) + 14) }], []);
  const overflow = (ends.at(-1)?.at ?? 0) - (HEIGHT - PAD.bottom);
  if (overflow > 0) for (const e of ends) e.at -= overflow;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * plotW;
    setHover(rounds.length === 1 ? 0 : Math.max(0, Math.min(last, Math.round((px / plotW) * last))));
  };
  const tipLeft = hover === null ? 0 : x(hover);
  // Each model change: between its round and the one before.
  const changes = modelChanges.map((r) => rounds.indexOf(r)).filter((i) => i > 0);
  const changed = new Set(changes);

  return (
    <div className="race-chart" data-testid="race-chart">
      <style>{STYLE}</style>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700 dark:text-zinc-300" data-testid="race-legend">
        {series.map((s, i) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: color(i) }} />
            {s.name}
          </li>
        ))}
      </ul>
      <div ref={box} className="relative w-full">
        {/* Drawn at the box's measured width; scaled to fit until it's measured. */}
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={labels.caption} className="block h-auto w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--axis)">
                {pct.format(t)}
              </text>
            </g>
          ))}
          {rounds.map((r, i) =>
            // Every round's number when they fit, else every few.
            rounds.length <= Math.floor(plotW / 28) || i % Math.ceil(rounds.length / Math.floor(plotW / 28)) === 0 || i === last ? (
              <text key={r} x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--axis)">
                {r}
              </text>
            ) : null,
          )}
          {changes.map((i) => {
            const at = (x(i - 1) + x(i)) / 2;
            return (
              <g key={`model-${i}`} data-testid="race-model-change">
                <line x1={at} x2={at} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--axis)" strokeWidth={1} strokeDasharray="3 3" />
                {labels.modelChange && (
                  // Beside the line, on the side with room (left of it in the plot's right half).
                  <text x={at > PAD.left + plotW / 2 ? at - 4 : at + 4} y={PAD.top + 10} textAnchor={at > PAD.left + plotW / 2 ? "end" : "start"} fontSize={10} fill="var(--axis)">
                    {labels.modelChange}
                  </text>
                )}
              </g>
            );
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--axis)" strokeWidth={1} />}
          {series.map((s, i) => (
            <g key={s.name}>
              {s.values.length > 1 && (
                <polyline
                  points={s.values.map((v, j) => `${x(j)},${y(v)}`).join(" ")}
                  fill="none"
                  stroke={color(i)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              <circle cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={color(i)} stroke="var(--surface)" strokeWidth={2} />
              {hover !== null && hover !== last && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={color(i)} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          ))}
          {endLabels &&
            ends.map((e) => {
              const s = series[e.i]!;
              return (
                <g key={s.name}>
                  {Math.abs(e.at - e.y) > 2 && <line x1={x(last) + 5} y1={e.y} x2={x(last) + 12} y2={e.at} stroke="var(--grid)" strokeWidth={1} />}
                  <text x={x(last) + 14} y={e.at} dy="0.32em" fontSize={11} className="fill-zinc-700 dark:fill-zinc-300">
                    {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name} {show(s.values[last] ?? 0)}
                  </text>
                </g>
              );
            })}
          {/* The hover layer: the whole plot, so the pointer only has to be near a round. */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            style={tipLeft > width / 2 ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }}
            role="status"
          >
            <p className="mb-1 font-semibold">
              {labels.round} {rounds[hover]}
            </p>
            {changed.has(hover) && labels.modelChange && <p className="mb-1 text-zinc-500">{labels.modelChange}</p>}
            <ul className="space-y-0.5">
              {series
                .map((s, i) => ({ s, i }))
                .sort((a, b) => (b.s.values[hover] ?? 0) - (a.s.values[hover] ?? 0))
                .map(({ s, i }) => (
                  <li key={s.name} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: color(i) }} />
                      {s.name}
                    </span>
                    <span className="font-semibold tabular-nums">{show(s.values[hover] ?? 0)}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-pitch-700 dark:text-pitch-300">{labels.table}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full table-fixed text-xs tabular-nums" data-testid="race-table">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="w-14 py-1 pr-2 font-semibold">{labels.round}</th>
                {series.map((s) => (
                  <th key={s.name} className="truncate py-1 pr-2 font-semibold" title={s.name}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, j) => (
                <tr key={r} className="border-t border-zinc-200/70 dark:border-zinc-800">
                  <td className="py-1 pr-2">
                    {r}
                    {changed.has(j) && labels.modelChange ? <span className="block text-[10px] leading-tight text-zinc-500">{labels.modelChange}</span> : null}
                  </td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-2">
                      {show(s.values[j] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
