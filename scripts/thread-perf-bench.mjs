#!/usr/bin/env node
// Replay the desktop thread-replies read against the thread-perf relay and
// capture EXPLAIN plans for the thread aux SQL. Reads target/thread-perf/thread.json
// written by thread-perf-seed.sh. Writes target/thread-perf/bench-<label>.json.
//
//   node scripts/thread-perf-bench.mjs [label]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(repoRoot, "target/thread-perf");
const relayUrl = process.env.TP_RELAY_URL ?? "http://localhost:3040";
const dbUrl = process.env.TP_DATABASE_URL ?? "postgres://buzz:buzz_dev@localhost:5481/buzz";
const label = process.argv[2] ?? "run";
const { channel, root, owner_pubkey: pubkey } = JSON.parse(readFileSync(join(stateDir, "thread.json"), "utf8"));
const TIMEOUT_MS = 60_000;
// desktop/src-tauri/src/commands/messages.rs build_thread_replies_filter + TIMELINE_KINDS
const kinds = [9, 40002, 40008, 40099, 43001, 43002, 43003, 43004, 43005, 43006, 48100];
const psql = (sql) => execFileSync("psql", [dbUrl, "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", maxBuffer: 64 << 20 });

async function measure(limit, includeAux) {
  const filter = { "#e": [root], kinds, depth_limit: 64, limit, include_aux: includeAux, "#h": [channel] };
  const started = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${relayUrl}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pubkey": pubkey },
      body: JSON.stringify([filter]),
      signal: ctl.signal,
    });
    const headersMs = performance.now() - started;
    const body = await res.json();
    const totalMs = performance.now() - started;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const replies = body.filter((e) => kinds.includes(e.kind) && e.id !== root).length;
    return { limit, includeAux, status: res.status, headersMs, totalMs, events: body.length, replies };
  } catch (e) {
    return { limit, includeAux, error: e.name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : e.message, totalMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Mirrors of buzz-db query_events_on for the thread aux hop 1 (bridge.rs
// build_aux_query over root + replies, WINDOW_AUX_KINDS), literals inlined:
// the pre-fix N-way OR shape, and the MATERIALIZED-fenced ANY shape.
const AUX_COLS = "id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id";
const auxWhere = `community_id = (SELECT community_id FROM channels WHERE id = '${channel}') AND deleted_at IS NULL
AND kind IN (5, 7, 9005, 40003)`;
const auxShapes = {
  or: (ids) => `SELECT ${AUX_COLS} FROM events
WHERE ${auxWhere} AND (${ids.map((id) => `tags @> '[["e","${id}"]]'::jsonb`).join(" OR ")})
ORDER BY created_at DESC, id ASC LIMIT 1000 OFFSET 0`,
  fence_any: (ids) => `WITH m AS MATERIALIZED (SELECT ${AUX_COLS} FROM events
WHERE ${auxWhere} AND tags @> ANY(ARRAY[${ids.map((id) => `'[["e","${id}"]]'`).join(", ")}]::jsonb[]))
SELECT * FROM m ORDER BY created_at DESC, id ASC LIMIT 1000 OFFSET 0`,
};

// GIN pending-list state per partition tags index; aux plans depend on it.
const ginPending = () => psql(`SELECT c.relname, s.pending_pages, s.pending_tuples FROM pg_inherits i
  JOIN pg_index x ON x.indrelid = i.inhrelid JOIN pg_class c ON c.oid = x.indexrelid
  JOIN pg_am a ON a.oid = c.relam AND a.amname = 'gin' AND c.relname LIKE '%\\_tags\\_idx', pgstatginindex(c.oid) s
  WHERE i.inhparent = 'events'::regclass ORDER BY 1`).trim().split("\n").map((l) => {
  const [index, pages, tuples] = l.split("|");
  return { index, pendingPages: Number(pages), pendingTuples: Number(tuples) };
});

// Provenance of the relay under test, from the manifest `seed.sh relay` wrote;
// refuse to run if the listening process is not that PID.
function measuredRelay() {
  const m = JSON.parse(readFileSync(join(stateDir, "relay.json"), "utf8"));
  const port = new URL(relayUrl).port;
  const listener = execFileSync("lsof", ["-t", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (listener !== String(m.pid)) throw new Error(`:${port} is held by pid ${listener}, not manifest pid ${m.pid}`);
  return m;
}

const threadIds = [root, ...psql(
  `SELECT encode(e.id,'hex') FROM events e WHERE e.channel_id = '${channel}' AND e.kind = 9 AND e.tags @> '[["e","${root}"]]' ORDER BY e.created_at, e.id`,
).trim().split("\n").filter(Boolean)];

const report = {
  label, started: new Date().toISOString(),
  runnerCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  relay: measuredRelay(),
  ginPendingBefore: ginPending(),
  eventsTotal: Number(psql("SELECT sum(reltuples)::bigint FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid WHERE i.inhparent = 'events'::regclass").trim()),
  threadIds: threadIds.length, runs: [], explain: {},
};
for (let run = 1; run <= 3; run++) {
  for (const includeAux of [false, true]) {
    for (const limit of [10, 50, 100, 200]) {
      const r = { run, ...(await measure(limit, includeAux)) };
      report.runs.push(r);
      console.log(JSON.stringify(r));
    }
  }
}
for (const [shape, build] of Object.entries(auxShapes)) {
  for (const n of [100, threadIds.length]) {
    const sql = build(threadIds.slice(0, n));
    const started = performance.now();
    const plan = psql(`SET statement_timeout = '120s'; EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    const key = `${shape}_${n}`;
    report.explain[key] = { shape, ids: n, sqlSha256: createHash("sha256").update(sql).digest("hex"), wallMs: performance.now() - started, plan };
    console.log(`--- EXPLAIN aux ${shape} ${n} ids (${report.explain[key].wallMs.toFixed(0)} ms)\n${plan}`);
  }
}
report.ginPendingAfter = ginPending();
const out = join(stateDir, `bench-${label}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
