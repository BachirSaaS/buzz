import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecurityDraft } from "./AgentSecurityField.tsx";
import { sandpitAvailability } from "../lib/agentConfigCore.ts";

test("security capability requires settled native metadata", () => {
  assert.equal(
    sandpitAvailability({ supportsSandpit: true }, "loading"),
    "unknown",
  );
  assert.equal(sandpitAvailability(undefined, "error"), "unknown");
  assert.equal(
    sandpitAvailability({ id: "buzz-agent" }, "ready"),
    "unsupported",
  );
  assert.equal(
    sandpitAvailability({ id: "new-runtime", supportsSandpit: true }, "ready"),
    "available",
  );
});

test("multiline drafts normalize only at Save, retaining explicit deny-all", () => {
  const draft = {
    schema_version: 1,
    writable_roots: [" /tmp/work ", ""],
    denied_reads: ["/tmp/protected", ""],
    denied_writes: [],
    network: { mode: "allowlist", destinations: [""] },
    environment: [" NAME ", ""],
  };
  const saved = normalizeSecurityDraft(draft);
  assert.deepEqual(saved.writable_roots, ["/tmp/work"]);
  assert.deepEqual(saved.network, { mode: "allowlist", destinations: [] });
  assert.deepEqual(saved.environment, ["NAME"]);
  assert.equal(draft.writable_roots.length, 2);
  assert.equal(normalizeSecurityDraft(null), null);
});

test("draft validation blocks incomplete restrictions without erasing saved policy", async () => {
  const { securityDraftError } = await import("./AgentSecurityField.tsx");
  const policy = {
    schema_version: 1,
    writable_roots: ["/tmp/work"],
    denied_reads: [],
    denied_writes: [],
    network: { mode: "deny_all" },
    environment: [],
  };
  assert.equal(securityDraftError(null), null);
  assert.equal(securityDraftError(policy), null);
  assert.match(
    securityDraftError({ ...policy, writable_roots: [" "] }),
    /Add at least one/,
  );
  assert.match(
    securityDraftError({ ...policy, denied_reads: ["~/secret"] }),
    /full paths/,
  );
  assert.match(
    securityDraftError({ ...policy, writable_roots: ["/tmp/../secret"] }),
    /full paths/,
  );
  assert.match(
    securityDraftError({ ...policy, environment: ["KEY=value"] }),
    /names only/,
  );
  assert.match(
    securityDraftError({
      ...policy,
      network: { mode: "allowlist", destinations: [" "] },
    }),
    /allowed domain/,
  );
  assert.equal(securityDraftError({ ...policy, writable_roots: null }), null);
});
