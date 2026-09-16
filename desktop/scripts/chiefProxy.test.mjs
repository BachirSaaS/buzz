import assert from "node:assert/strict";
import test from "node:test";
import { allowedChiefRoute, requestChief } from "./chiefProxy.ts";

const scope = { relay: "https://buzz.example", pubkey: "a".repeat(64) };
test("mismatched daemon identity or community prevents reads and writes", async () => {
  for (const status of [
    { ...scope, pubkey: "b".repeat(64) },
    { ...scope, relay: "wss://other.example" },
  ]) {
    const calls = [];
    await assert.rejects(
      requestChief(
        { scope, method: "POST", path: "/folds/week/run" },
        async (url) => {
          calls.push(url);
          return Response.json(status);
        },
      ),
      /different identity or community/,
    );
    assert.deepEqual(calls, ["http://127.0.0.1:4640/status"]);
  }
});
test("preflight reaches the pinned loopback endpoint without invoking run", async () => {
  const calls = [];
  const data = await requestChief(
    {
      scope,
      method: "POST",
      path: "/folds/week/preflight",
      body: { include_input: true },
    },
    async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        calls.length === 1
          ? { ...scope, relay: "wss://buzz.example/" }
          : { plan: "ready" },
      );
    },
  );
  assert.deepEqual(data, { plan: "ready" });
  assert.equal(calls[1].url, "http://127.0.0.1:4640/folds/week/preflight");
  assert.equal(calls[1].init.body, '{"include_input":true}');
  assert.equal(calls[1].init.redirect, "error");
});
test("publication, deletion and path escapes are blocked before any network call", async () => {
  for (const [method, path] of [
    ["POST", "/folds/week/artifacts/1/publish"],
    ["DELETE", "/folds/week"],
    ["GET", "//other.example"],
    ["GET", "/folds/../status"],
    ["PUT", "/folds/a%2fb"],
  ]) {
    assert.equal(allowedChiefRoute(method, path), false);
    await assert.rejects(
      requestChief({ scope, method, path }, () => {
        throw new Error("unexpected network");
      }),
      /Unsupported briefing/,
    );
  }
});
test("oversized daemon responses fail rather than retaining unlimited output", async () => {
  await assert.rejects(
    requestChief(
      { scope, method: "GET", path: "/status" },
      async () => new Response(" ".repeat(4_000_001)),
    ),
    /too large/,
  );
});
