"use client";

import { useEffect, useRef, useState } from "react";
import type { CupMonteCarloInput, CupMonteCarloResult } from "../engine/cupMontecarlo.ts";
import type { MonteCarloInput, MonteCarloResult } from "../engine/montecarlo.ts";
import type { MonteCarloRequest, MonteCarloResponse } from "../workers/montecarlo.worker.ts";

export const ITERATIONS = 10_000;

/** Runs a Monte Carlo in a Web Worker, debounced, keeping only the latest answer. */
export function useMonteCarlo(input: MonteCarloInput | null, kind?: "league"): MonteCarloResult | null;
export function useMonteCarlo(input: CupMonteCarloInput | null, kind: "cup"): CupMonteCarloResult | null;
export function useMonteCarlo(input: MonteCarloInput | CupMonteCarloInput | null, kind: "league" | "cup" = "league") {
  const [result, setResult] = useState<MonteCarloResult | CupMonteCarloResult | null>(null);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("../workers/montecarlo.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MonteCarloResponse>) => {
      if (e.data.id === latest.current) setResult(e.data.result);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!input) return;
    const id = ++latest.current;
    setResult(null);
    const timer = setTimeout(() => {
      const request = (kind === "cup" ? { id, kind, input } : { id, kind, input }) as MonteCarloRequest;
      worker.current?.postMessage(request);
    }, 300);
    return () => clearTimeout(timer);
  }, [input, kind]);

  return result;
}
