# NIP-WO: Versioned work relationships (draft)

Relay-only draft of vision PR #7615. This revision replaces the initial five-object
proposal: **new projects and tasks, reused Git objects, explicit versioned home tags**.
It intentionally supersedes the old project-grouping/branch-channel interpretation
in VISION_PROJECTS for enrolled work. No client changes or automatic migration.

## Objects versus relationships

| Kind | Meaning | Identity | Home |
|---|---|---|---|
| 45010 | New project state | Community-local UUID | Exclusive channel |
| 45012 | New task state | Community-local UUID | Exclusive thread in project channel |
| 45011 | Repository home binding, NOT repository state | Existing `30617:<owner>:<d>` | Exclusive repository channel |
| 45014 | Branch home binding, NOT ref state | Repository coordinate + full `refs/heads/...` | Thread; may share with task/other branches |

Repositories remain NIP-34 30617, refs remain 30618, PRs/patches/updates/statuses
retain their existing identities and code meanings. A 30618 can contain many refs:
its event ID is **not** one branch's identity. No new repo/branch UUID is introduced.
The binding's revision event ID is evidence of a claim, not a replacement Git ID.
Git binding `state` must be null: no duplicate title, commit, ref or protection state.

Tasks belong to projects, never require a repository, and are not NIP-34 issues.
Optional implementing-code references belong in task state and grant no access.
Project/repository grouping can remain many-to-many metadata, not ownership.
Documents are deferred: 45013 is not registered/accepted by this protocol. Existing
canvases/articles are not automatically canonical documents. A future document
contract must share the task/document exclusive-thread constraint from the vision.

## Signed tags: `buzz-rooms-1`

Every declaration carries exactly one `v=buzz-rooms-1` and one `h=<channel UUID>`.
Tags are two-element arrays. UUIDs use non-nil lowercase hyphenated form; event IDs
are lowercase 64-hex. Duplicate, unknown, malformed or inapplicable tags are rejected
on these four declaration kinds; this is a deliberately strict first version.

| Tag | Project | Task | Repo binding | Branch binding |
|---|---|---|---|---|
| `v`, `h` | required | required | required | required |
| `object` UUID | required | required | prohibited | prohibited |
| `root` event ID | prohibited | required | prohibited | required |
| `project` UUID | prohibited | required | prohibited | prohibited |
| `parent` task UUID | prohibited | optional | prohibited | prohibited |
| `a` repo coordinate | prohibited | prohibited | required | required |
| `ref` full Git ref | prohibited | prohibited | prohibited | required |

`a` retains its standard address-reference meaning. Custom `root` is an explicit
home pointer, not an `e` reply: declarations are state, do not increment thread
counters, and do not become messages. No JSON `home` duplicate is accepted.

Example task (placeholders below stand for valid IDs):

```json
{
  "kind": 45012,
  "tags": [
    ["v", "buzz-rooms-1"],
    ["h", "<project-channel-uuid>"],
    ["object", "<task-uuid>"],
    ["project", "<project-uuid>"],
    ["root", "<ordinary-message-event-id>"]
  ],
  "content": "{\"previous\":null,\"deleted\":false,\"state\":{\"title\":\"Improve sign-in\"}}"
}
```

A branch binding substitutes `a` and `ref` for task/project identity, retains its
own discussion `h`/`root`, and carries `state:null`. The repo coordinate parser splits
only the first two colons, preserving external repository identifiers with colons.

## What the relay enforces at write time

| Write | Draft behavior |
|---|---|
| Legacy project/issue/canvas or unbound Git record | Existing acceptance rules; does not acquire a canonical home |
| New declaration without valid version/tags | Reject; no legacy fallback for new kinds |
| Valid-shaped declaration | Validate membership, authority, relationship targets and atomic exclusive claims |
| Concurrent claim for same channel/task thread | One succeeds; other fails without persisting an orphan declaration |
| Task/subtask | Live project required; root in project channel; parent task in same project |
| Revision | Same identity and home; exact current-head `previous`; no timestamp overwrite |
| Repo announcement after binding | Reject missing/duplicate/different `buzz-channel`, or retired binding, even through raw insert/recreation |
| Git ref push | Existing transport rules; does not require/create a branch discussion |

Only accepted declarations enroll an identity. A `v` tag on a legacy kind does not
enroll it. Future clients query these declaration kinds and validate the scheme,
then resolve reused Git targets; a bare legacy 30617 is not a canonical repo card.
They ignore off-scheme objects **in new work-object views**, rather than infer homes
from old tags, synthesize projects from repos, or create proxy repos for tasks.
The relay need not reject all old data merely because the new client ignores it.

Channel/home and index updates commit atomically with the signed declaration.
Project and repository bindings compete for one channel slot. Tasks have exclusive
thread slots. Branch bindings may share those task threads or standalone roots.
Roots must be live top-level ordinary messages with thread metadata. Legacy roots
without metadata require explicit preparation; no automatic conversation moves.

Project writes require channel owner/admin; task writes require non-guest membership.
Repository adoption requires the repository signer AND destination channel admin,
and exactly one existing `buzz-channel` matching that destination. Branch binding
requires repository-channel admin AND discussion-channel membership. Scoped tokens
cannot currently register cross-channel branches; unscoped `messages:write` plus
`repos:write` is required. Claims lock channel/member rows during acceptance.

## Revisions and lifecycle: draft choices, not requirements of the vision

Declarations are regular persisted events, not author-addressed NIP-01 replacements.
Their content has `previous`, `deleted`, and `state`. CAS/shared channel writers are
retained from the initial draft for review; they are **not needed just to version
relationships**. State is opaque project/task JSON, not a settled task workflow or
assignment engine. Existing issue status/assignment events never mutate tasks.

Homes are immutable. Tombstones are terminal and retain reservations, preventing
reuse through a new identity. Generic deletion of declaration events is rejected.
Repository binding retirement is not Git deletion or code-access revocation. A raw
ref may disappear/reappear without changing its home binding. Renames/new ref names
are distinct targets; automated rename/move workflows are not implemented.

The `work_objects` table is a derived community-scoped index: project/task UUIDs,
repo coordinates, or unambiguous encoded repo/ref tuples are its keys. It is not a
second public Git namespace. This revision edits the unshipped migration 0045;
it is not an upgrade path from a database running the first draft of this PR.

## Audience and rollout blockers — do not mistake filtering for privacy

Project/task state and home declarations use channel-scoped storage and fanout.
A branch declaration follows its discussion audience. Access to its code continues
to follow the repo channel. A relation never grants access across those boundaries.

**This draft does NOT yet retrofit the community-global NIP-34 metadata audience.**
Existing repository announcements, ref state (including relay-generated 30618),
PRs and patches still follow legacy metadata paths. Home binding alone must not be
marketed as making those records private. Before enabling private canonical Git
work, implement repo-derived audience checks across ingestion, generated writes,
history/query/count/search/live fanout, and reference disclosure. Previously delivered
global content cannot be made unseen; do not export private state as global copies.

Remaining review/rollout requirements:
- Complete root retention/deletion and channel lifecycle race policy and coverage.
- Expand deletion/moderation/Git announcement deletion-recreation adversarial tests;
  raw repository writes are fenced but this is not a complete lifecycle proof.
- Private search/live-delivery and broader multi-tenant tests for declarations.
- Settle project/task typed state, writer granularity and revision policy.
- Define document representation and migration/adoption UX separately.
- Explicitly repair conflicting project/default-repo shared homes; do not auto-adopt.

No client implementation, production data migration, or readiness-to-merge claim.
