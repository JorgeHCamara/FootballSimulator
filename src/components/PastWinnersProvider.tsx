"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DivisionCode } from "../lib/myWorld.ts";
import type { WinnerRow } from "../lib/winners.ts";

/** The real Past Winners of My World's leagues (src/data/history), by division, read on the server; a league without a file is absent. */
export type RealWinners = Partial<Record<DivisionCode, WinnerRow[]>>;

const RealWinnersContext = createContext<RealWinners>({});

export function PastWinnersProvider({ value, children }: { value: RealWinners; children: ReactNode }) {
  return <RealWinnersContext.Provider value={value}>{children}</RealWinnersContext.Provider>;
}

export const useRealWinners = () => useContext(RealWinnersContext);
