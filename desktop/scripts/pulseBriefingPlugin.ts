import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Plugin } from "vite";

const instructions = await readFile(
  new URL("../pulse-summary-instructions.md", import.meta.url),
  "utf8",
);
const schema = JSON.parse(
  await readFile(
    new URL("../pulse-summary-schema.json", import.meta.url),
    "utf8",
  ),
);

async function summarize(input: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "buzz-pulse-summary-"));
  try {
    const output = path.join(dir, "result.json");
    const schemaPath = path.join(dir, "schema.json");
    const instructionPath = path.join(dir, "instructions.md");
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    await writeFile(instructionPath, instructions, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.env.BUZZ_PULSE_CODEX_BIN || "codex",
        [
          "exec",
          "--model",
          "gpt-5.6-terra",
          "--ignore-user-config",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--disable",
          "shell_tool",
          "--disable",
          "multi_agent",
          "--disable",
          "apps",
          "--disable",
          "plugins",
          "-c",
          'web_search="disabled"',
          "-c",
          "tools.view_image=false",
          "-c",
          "project_doc_max_bytes=0",
          "-c",
          'model_reasoning_effort="low"',
          "-c",
          `model_instructions_file=${JSON.stringify(instructionPath)}`,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          output,
          "-",
        ],
        { cwd: dir, detached: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let bytes = 0;
      let failure: Error | null = null;
      const stop = (reason: string) => {
        failure = new Error(reason);
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              failure = new Error("Could not stop summary process");
          }
        }
      };
      const timer = setTimeout(
        () => stop("Summary timed out. Try again."),
        90_000,
      );
      const drain = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1_000_000) stop("Summary output exceeded its limit");
      };
      child.stdout.on("data", drain);
      child.stderr.on("data", drain);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Codex connection unavailable"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure || code !== 0)
          reject(
            failure ??
              new Error(
                "Codex could not create the briefing. Check its sign-in and try again.",
              ),
          );
        else resolve();
      });
      child.stdin.on("error", () => stop("Could not submit summary"));
      child.stdin.end(input);
    });
    const text = await readFile(output, "utf8");
    if (text.length > 12_000) throw new Error("Summary was too large");
    return JSON.parse(text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Local prototype adapter; never installed on the production relay. */
export function pulseBriefingPlugin(provider?: string): Plugin {
  const cache = new Map<string, { expires: number; result: unknown }>();
  let running: { key: string; promise: Promise<unknown> } | null = null;
  return {
    name: "pulse-briefing",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__pulse/briefing", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.end(JSON.stringify({ error: message }));
        };
        if (provider !== "codex") {
          fail(503, "Briefing model connection is not enabled");
          return;
        }
        if (
          req.method !== "POST" ||
          req.headers.origin !== `http://${req.headers.host}` ||
          !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? "")
        ) {
          fail(403, "Local app requests only");
          return;
        }
        try {
          let input = "";
          for await (const chunk of req) {
            input += chunk.toString();
            if (Buffer.byteLength(input) > 200_000) {
              fail(413, "Briefing input too large");
              return;
            }
          }
          const parsed = JSON.parse(input);
          if (
            !Array.isArray(parsed.conversations) ||
            parsed.conversations.length > 30
          ) {
            fail(400, "Invalid briefing input");
            return;
          }
          const key = createHash("sha256").update(input).digest("hex");
          const cached = cache.get(key);
          if (cached && cached.expires > Date.now()) {
            res.end(JSON.stringify(cached.result));
            return;
          }
          if (running && running.key !== key) {
            fail(429, "Briefing is updating. Try again shortly.");
            return;
          }
          if (!running) {
            const promise = summarize(input)
              .then((result) => {
                if (cache.size >= 10)
                  cache.delete(cache.keys().next().value as string);
                cache.set(key, { result, expires: Date.now() + 300_000 });
                return result;
              })
              .finally(() => {
                running = null;
              });
            running = { key, promise };
          }
          res.end(JSON.stringify(await running.promise));
        } catch (error) {
          fail(
            503,
            error instanceof Error ? error.message : "Briefing unavailable",
          );
        }
      });
      server.httpServer?.once("close", () => cache.clear());
    },
  };
}
