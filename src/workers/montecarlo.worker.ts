import { runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from "../engine/montecarlo.ts";

export interface MonteCarloRequest {
  id: number;
  input: MonteCarloInput;
}

export interface MonteCarloResponse {
  id: number;
  result: MonteCarloResult;
}

self.onmessage = (event: MessageEvent<MonteCarloRequest>) => {
  const { id, input } = event.data;
  const response: MonteCarloResponse = { id, result: runMonteCarlo(input) };
  self.postMessage(response);
};
