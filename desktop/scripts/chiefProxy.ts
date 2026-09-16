import type { Plugin } from "vite";

const BASE = "http://127.0.0.1:4640";
const MAX_RESPONSE = 4_000_000;
export function allowedChiefRoute(method: string, path: string): boolean {
  const name = "[A-Za-z0-9_-]{1,128}";
  if (method === "GET")
    return (
      /^(\/(status|channels|models|folds)|\/events\/[a-f0-9]{64})$/.test(
        path,
      ) ||
      new RegExp(`^/folds/${name}(/artifacts(/[1-9][0-9]{0,5})?)?$`).test(path)
    );
  if (method === "PUT") return new RegExp(`^/folds/${name}$`).test(path);
  return (
    method === "POST" &&
    (/^\/select\/(preview|events)$/.test(path) ||
      new RegExp(`^/folds/${name}/(preflight|run)$`).test(path))
  );
}
export function relayOrigin(raw: string): string {
  const url = new URL(raw.replace(/^ws:/, "http:").replace(/^wss:/, "https:"));
  return url.href.replace(/\/$/, "");
}
async function readJson(response: Response) {
  if (!response.body) throw new Error("Empty Accumulator response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE)
        throw new Error("Accumulator response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok)
    throw new Error(value.error ?? "Accumulator request failed.");
  return value;
}
/** Fixed loopback destination; no publishing, arbitrary URLs, or credential forwarding. */
export async function requestChief(
  input: {
    path: string;
    method: string;
    body?: unknown;
    scope: { relay: string; pubkey: string };
  },
  transport: typeof fetch = fetch,
) {
  if (!allowedChiefRoute(input.method, input.path))
    throw new Error("Unsupported briefing operation.");
  const status = await readJson(
    await transport(`${BASE}/status`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }),
  );
  if (
    !input.scope.pubkey ||
    status.pubkey !== input.scope.pubkey ||
    relayOrigin(status.relay) !== relayOrigin(input.scope.relay)
  )
    throw new Error(
      "The Accumulator is connected to a different identity or community.",
    );
  if (input.path === "/status") return status;
  return readJson(
    await transport(BASE + input.path, {
      method: input.method,
      headers: { "Content-Type": "application/json" },
      body:
        input.method === "GET" ? undefined : JSON.stringify(input.body ?? {}),
      redirect: "error",
      signal: AbortSignal.timeout(
        input.path.endsWith("/run") ? 615_000 : 10_000,
      ),
    }),
  );
}
export function chiefProxy(): Plugin {
  return {
    name: "chief-local-briefings",
    configureServer(server) {
      server.middlewares.use("/__chief", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        try {
          const origin = req.headers.origin;
          if (
            req.method !== "POST" ||
            (origin && new URL(origin).host !== req.headers.host)
          )
            throw new Error("Unsupported request origin.");
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (Buffer.byteLength(raw) > 64_000)
              throw new Error("Briefing request is too large.");
          }
          res.end(JSON.stringify(await requestChief(JSON.parse(raw))));
        } catch (error) {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error:
                error instanceof Error && error.message !== "fetch failed"
                  ? error.message
                  : "Local briefings are unavailable. Start the Accumulator and retry.",
            }),
          );
        }
      });
    },
  };
}
