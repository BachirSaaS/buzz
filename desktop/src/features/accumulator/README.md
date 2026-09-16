# Saved briefings prototype

Home’s private briefing cards connect the existing Block UI shell to Riley Crane's
Intelligence Workbench / Accumulator at commit
`5d12db76c0b6b59c686c5a9aaf9d2367bd73f7ad`. It is an external local service;
its source is downloaded into `.cache/chief/source`, not merged into Buzz.

From the Buzz checkout, run `./scripts/run-chief-accumulator.sh` on macOS.
This downloads/builds the pinned daemon, reads the same Keychain identity as the
Block UI staging launcher, and starts it on `127.0.0.1:4640`. Keep that terminal
running. Source/build outputs and identity/community-specific databases live
under `.cache/chief/`. `--source-dir /path/to/intelligence-workbench` can reuse a
clean checkout at the pinned commit. `--build-only` builds without starting sync.
Use `--relay wss://...` to explicitly select another community.

Then build/run the desktop normally (or use the staging launcher). Vite browser
development uses the same fixed-loopback bridge at `/__chief`. Native builds use
`accumulator_request`; existing installed native builds need rebuilding to pick
up this command. Both bridges verify daemon identity/community before returning
data. The native bridge also verifies the app's active scope and its generation
before/after requests. Query caches and components are scoped to the current
identity and community. Neither bridge exposes publishing or deletion.

The launcher passes the identity via a temporary owner-only file and removes it
when the daemon exits. Model subprocesses receive no Buzz signing variables.
The local CLI adapter disables tools/config integrations and caps output at 1 MB
and runtime at 590 seconds, inside the upstream process group.

The first slice supports one channel, kind-9 messages, a fixed local-date window,
a model, and a prompt. End dates are exclusive. Save is one durable fold write;
preflight does not run a model. Run explicitly processes one pass using the
signed-in CLI account. Each pass persists an immutable version; partial coverage
stays visible. A different prompt/model experiment creates a new fold. Existing
folds from Riley's workbench can also be inspected.

Private briefings and recent activity appear together in Home. Explicit Markdown
list items become individual cards, each with only its own cited messages.
Free-form prose stays in one card rather than guessing at claim boundaries.
Both sources use HomeFeedCard, HomeParticipants, HomeEvidenceGrid,
HomeMessageEvidence, and the same action row. A small label preserves the
briefing's title/date context. The existing Snooze and Reply placeholders remain
disabled; Open conversation targets that card's selected source.

References resolve only against the selected version's `shown_ids`; unavailable
references are labeled and never fetched. Uncited inputs are not presented as
evidence for a takeaway. Home displays the latest saved version and omits the experiment-details row.
Original output, prior versions, and prompts remain stored in the Accumulator. A multi-source takeaway can page through its
cited messages within the card. At most twelve takeaways load initially per
briefing, with a More takeaways action for the rest; saved briefings are paged
five at a time.

Matching an ID proves only that the message was supplied, not that it supports
the claim. Earlier versions keep their own sources. Legacy
`/pulse?briefings=saved` links open the combined Home feed. The current 48-hour
catch-up remains below saved briefing cards, including when the Accumulator is
unavailable.

This keeps private derived artifacts local while the relay remains authoritative
for conversation history, consistent with VISION.md. This prototype has no
scheduling, auto-run, publishing, People Lab, or engine import into the native
binary. A failed run is visible and never automatically retried. An upstream
version-fence failure returns paid-for text for manual recovery; it is not saved
as an artifact. The UI retains a separate scoped local recovery record; storage
failures remain visible and ask the user to copy the result before leaving.

Validation: `pnpm test:e2e:smoke chief-briefings.spec.ts` exercises the production
UI against a mocked daemon boundary. `chiefProxy.test.mjs` tests the actual
transport scope/route gate. Native route-gate tests are in `commands/accumulator.rs`.
The upstream daemon has its own tests; they are not part of Buzz's `just ci`.
