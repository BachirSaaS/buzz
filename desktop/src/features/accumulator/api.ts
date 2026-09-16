import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ChiefScope } from "./types";

/** All data and cache keys are bound to the signed-in identity and community. */
export function chiefApi(scope: ChiefScope) {
  return async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const input = { scope, path, method, body: body ?? null };
    if (isTauri() && import.meta.env.MODE !== "e2e")
      return invoke<T>("accumulator_request", { input }).catch((error) => {
        throw new Error(String(error));
      });
    const response = await fetch("/__chief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(path.endsWith("/run") ? 620_000 : 15_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        error?.error ??
          "Local briefings are unavailable. Start the Accumulator and retry.",
      );
    }
    return response.json();
  };
}
