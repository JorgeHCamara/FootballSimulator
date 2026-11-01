import { runCupMonteCarlo, type CupMonteCarloInput, type CupMonteCarloResult } from "../engine/cupMontecarlo.ts";
import { runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from "../engine/montecarlo.ts";

export type MonteCarloRequest =
  | { id: number; kind?: "league"; input: MonteCarloInput }
  | { id: number; kind: "cup"; input: CupMonteCarloInput };

export interface MonteCarloResponse {
  id: number;
  result: MonteCarloResult | CupMonteCarloResult;
}

self.onmessage = (event: MessageEvent<MonteCarloRequest>) => {
  const request = event.data;
  const result = request.kind === "cup" ? runCupMonteCarlo(request.input) : runMonteCarlo(request.input);
  const response: MonteCarloResponse = { id: request.id, result };
  self.postMessage(response);
};
