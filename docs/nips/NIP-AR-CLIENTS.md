# Artifact client contracts

`draft` `clients` `not implemented`

Depends on [NIP-AR](NIP-AR.md). These are shared desktop, mobile, CLI, SDK, and
agent contracts, **not relay business validation rules**. All types use the same
artifact envelope and lifecycle. Each may live in a channel or a thread.

## Common content rules

Known version-1 payloads are JSON objects with an integer `version: 1`. Reject
ambiguous duplicate JSON keys when interpreting a known payload. Unknown fields
are permitted. Editors preserve unknown fields and annotation tags or refuse an
unsafe edit. Required title exists only in the envelope, not a second writable
payload field. Markdown descriptions are untrusted and rendered safely.
Version-1 writers limit the complete content to 65,536 UTF-8 bytes and
`status_label` to 128 UTF-8 bytes; they must also respect the relay event limit.
Clients use a bounded fallback rather than deeply parsing oversized content.

A malformed known type uses the fallback card with a clear unavailable-details
state. Unknown types/versions show type, title, last editor, and a route to the
home conversation when available. They must not disappear from the workspace.
The default experience works without selecting or installing plugins.

## `buzz.project`

A grouping of related work, not a channel identity or access-control container.

| Payload field | Type | Meaning |
|---------------|------|---------|
| `version` | integer | `1` |
| `description` | string | Project purpose/outcome, Markdown |
| `archived` | boolean | Inactive in default project views, not deleted |

Tasks declare their project relationships; the project must not contain a second
independently editable task-membership list. Project-owned `repository` tags may
reference multiple NIP-34 coordinates; `channel` tags may reference related
channel UUIDs. These are organizational references only. The project view is not
proof of completeness for work the reader cannot access.

A project may have a dedicated channel or share a team channel with other
projects. Archiving hides neither its channel nor its tasks and does not revoke
access. Clients may warn about adding work to an archived project; this is not a
relay rule or permission boundary.

## `buzz.task`

A living definition of work, independent of any prerequisite project or repo.

| Payload field | Type | Meaning |
|---------------|------|---------|
| `version` | integer | `1` |
| `description` | string | Intended outcome and agreed scope, Markdown |
| `state` | string | `open`, `done`, or `cancelled` |
| `status_label` | string, optional | Display refinement, e.g. “In review” |

The broad state supports common views; teams may use labels without a relay
deploy. Clients must not infer done/cancelled solely from an arbitrary label.
Assignees use repeatable `assignee` tags containing public keys. Assignment here
is task metadata, not permission to read or edit, and does not automatically
notify or subscribe the assignee. `assignee` deliberately differs from `p`,
which participates in mention/notification and recipient-validation behavior.
Notification policy is separate.

| Relationship tag | Count | Value |
|------------------|-------|-------|
| `project` | 0..N | Project artifact UUID |
| `parent` | 0..1 | Parent task artifact UUID |
| `branch` | 0..N | Branch artifact UUID |

Tags have two string elements and duplicate values are collapsed by conforming
clients. Relationships are editable; they need not have the same home channel.
A parent is organizational, not necessarily a conversation ancestor. A client
should prevent known cycles during authoring and must safely render cycles from
other writers. Missing/unreadable links do not invalidate the remaining task.

Completing or cancelling a task does not close its conversation, archive its
channel, or imply that a Git branch merged. Adding it to a project does not move
it or widen its audience. The same task may appear in several project views.

## `buzz.branch`

A collaboration record concerning a Git branch; not the ref itself or a second
review/merge authority.

| Payload field | Type | Meaning |
|---------------|------|---------|
| `version` | integer | `1` |
| `description` | string | Purpose/context, Markdown |
| `retired` | boolean | This collaboration record is no longer active |

Required tags are `repository` (a NIP-34 `30617:<owner-hex>:<identifier>`
coordinate) and `ref` (a valid full `refs/heads/...` Git ref). Split the coordinate
on its first two colons only. Clients validate Git ref syntax with established
Git-compatible validation, not an invented permissive approximation.

A record may precede first push. Its repository/ref pair is immutable in this
client contract: another ref or a recreated branch lifecycle gets a new record.
Retirement is terminal for this client version. These are client semantics;
the relay does not certify them. Multiple records may reference the same ref;
clients may offer duplicate cleanup without merging their identities silently.

Git tips, push rights, checks, approval, and merge state come from authoritative
Git/review sources under their own access checks, never this editable payload.
A branch card must not fetch and expose code to everyone who can see the card.
Automatic summaries/notifications must respect the destination audience too.

## Example: task started in a conversation

Standard signed-event fields are omitted. Placeholder IDs below are explanatory.
The numeric kind is proposed; see the allocation note in NIP-AR.

```json
{
  "kind": 45010,
  "tags": [
    ["ar", "1"],
    ["d", "<task-uuid>"],
    ["h", "<channel-uuid>"],
    ["root", "<conversation-event-id>"],
    ["type", "buzz.task"],
    ["title", "Handle payment timeout"],
    ["op", "create"]
  ],
  "content": "{\"version\":1,\"description\":\"Preserve the pending payment\",\"state\":\"open\"}"
}
```

Later adding `["project", "<project-uuid>"]` uses `op=update` and `prev` naming
the current accepted revision. It preserves `d`, `h`, and `root`. The project may
live elsewhere; viewing that project does not grant access to this task.

## Compatibility release gate

Publish shared valid/invalid fixtures before shipping editors. Exercise them
in desktop, mobile, CLI/SDK, and agent tooling: unsupported versions, unknown
fields/tags, bad JSON, cycles, inaccessible links, and concurrent updates.
The relay suite should demonstrate both envelope rejection and acceptance of
opaque content that a business client declines to interpret. Acceptance by one
layer is not a correctness certificate from the other.
