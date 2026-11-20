import { expect, it } from "vitest";
import { modelProblem } from "./thread-model";

it("FM: only model and provider errors count as model problems; timeouts and dropped connections don't", () => {
  for (const text of ["Thread thr_1 has no stored execution model", "Provider claude is not signed in", "Codex is signed out", "Model opus-9 is not available", "Unknown model: opus-9", "provider claude is unauthenticated"]) expect(modelProblem(new Error(text))).toBe(true);
  for (const text of ["Request timed out after 30000ms", "fetch failed", "connect ECONNREFUSED 127.0.0.1:38986", "socket hang up", "HTTP 500: database is locked"]) expect(modelProblem(new Error(text))).toBe(false);
});
