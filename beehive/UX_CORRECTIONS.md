# Manager UX corrections (F2–F5)

Presentation names are snapshot metadata only: command targets, revisions,
assignment and host-local enrollment authority remain unchanged. Confirmations
share agent/host presentation for Start, Stop, Restart, Move and saved choices.
Prompt first lines are short task titles; field guidance follows in the body.
Temporary notices retire only while still current, composing across nested
requests without erasing a newer result. Truly empty lists have zero options;
Controls remain available and retained real selections keep their existing policy.

## Short repeatable UX check

Run `beehive/tools/ux-walkthrough.sh` in a **100×30 terminal**. This uses the explicit
synthetic loader, fresh `beehive-pairing-cli-` credential file, private transport
and owned processes, and fences installed service/provider/native sign-in calls.
Do not substitute an ordinary manager launch or HOME-only isolation.

1. Agents while signed out: blank list, **0/0**, non-selectable “No items.”;
   arrows and Enter create no selection. Register/sign-in Controls stay visible.
2. Register → Runtime → hidden key → Esc: idle status returns; settings unchanged.
3. Sign in: title “Sign in”, shortened owner identity; Esc returns idle. Sign in
   again using the fixture's saved key; the real agent row replaces the empty list.
4. Start: title “Start agent?”, **Review agent / Review host**, not target JSON.
   Esc returns idle. Start → yes → Runtime → Esc retains the continuation result
   and leaves settings unchanged.
5. Focus Controls; wheel Details; refresh unchanged data: Controls remain visible,
   Details scroll stays put, and visible action clicks route to those actions.
   Provider/runtime forms use “Save provider”, “Save runtime”, “Custom model” and
   “Environment” titles, with context below, not a truncated sentence in the title.

Never enter live credentials. The fixture help supplies the canonical synthetic
nsec if testing registration beyond the cancellation checks above.

## Evidence for this delta

Workspace artifacts: `/Users/loganj/.buzz/artifacts/beehive-ux-f2-f5/`.

- **F2:** `f17-start-confirm.txt` / `.ansi` show named agent and local start host;
  `f08-signin-confirm.txt` shows shortened owner. Controller regression checks
  offer label projection and exact unchanged target JSON; existing lifecycle
  gates in that test still execute against the exact target/revision.
- **F3:** `f08`, `f17` show short titles in real PTY. Runtime form regression binds
  Save runtime, Custom model and Environment title/body labels to production forms.
  Other confirmation call sites share the same short-title convention.
- **F4:** `f07`, `f09`, `f18` show idle after cancellation; `f20` retains the
  continuation result. PTY verifies byte-identical settings after cancels.
  Renderer regression exercises nested notice retirement, newer result retention
  and the real action runner's completion cleanup.
- **F5:** `f02`–`f04` show zero rows through arrow/Enter. Renderer regression covers
  zero callbacks, accessible Controls, and transition back to real rows.
- **F1 retained:** renderer's original scroll/overflow-click/visibility regressions
  pass; `f12`–`f16` retain real PTY Controls and pointer/wheel evidence.

Direct Node **24.15.0** TypeScript passed. Focused controller/runtime/navigation:
**24 passed**. Pinned Bun **1.4.2** renderer: **8 passed**. Real synthetic PTY:
**20 checkpoints**, cancellation settings unchanged, clean exit **0**.
One final default-concurrent package suite: **245 passed, 1 failed, 19 skipped**
(43.507s). The unchanged broker test failed with “Conversation response timed out;
check relay admission and local sign-in”; full output is preserved in
`full-suite.log`. No deadlines/assertions weakened and no full-suite rerun.
No installed-opt-in rerun, live credential/provider/relay/browser operations,
service replacement, push, or repository-wide `just ci` claim. Earlier unchanged
provider/enrollment/Move/native evidence remains separately attributed in
`beehive-parity-b5cd2aa0` and `beehive-ux-25a9e2b7`.

The first PTY driver attempt incorrectly expected the Sign in title and Esc hint
on one line. Its stream/logs remain in `driver-first/`; only that observation
pattern was corrected, with the original deadline retained. The initial Bun
invocation lacked the required `./` path prefix and discovered no tests; the
explicit-path invocation above executed all eight tests.
