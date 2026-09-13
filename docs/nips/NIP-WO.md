# NIP-WO: Canonical work objects (draft)

This is a relay-only first implementation of the rooms model in vision PR #7615.
It intentionally replaces the *canonical* semantics proposed in VISION_PROJECTS
(author-owned grouping and branch channels), without changing the legacy NIP-MP
or NIP-34 wire contracts. No client adoption or automatic migration is included.

## Kinds and identity

| Kind | Object | Home | Writers |
|---|---|---|---|
| 45010 | Project | Exclusive channel | Channel owners/admins |
| 45011 | Repository adoption | Exclusive channel | Git owner **and** channel owner/admin |
| 45012 | Task | Exclusive thread in its project channel | Non-guest channel members |
| 45013 | Document | Exclusive thread | Non-guest channel members |
| 45014 | Registered branch | Thread, optionally shared with tasks/branches | Repository channel owner/admin **and** discussion channel member |

These are ordinary persisted events, **not** addressable replacements. Identity is
`(community, object UUID)`, independent of signer. Each revision repeats exactly
two tags: `["h", "<channel UUID>"]` and `["object", "<object UUID>"]`.
No `e` reply tags: state updates are not messages or replies and do not increment
thread counters. Query these kinds explicitly; the JSON `previous` chain determines
revision order, never client timestamps. Historical revisions remain queryable.

Content is a strict JSON envelope:

```json
{
  "home": {
    "object": "<UUID>",
    "channel": "<UUID>",
    "root": null,
    "project": null,
    "parent": null,
    "repository": null,
    "git": null,
    "branch": null
  },
  "previous": null,
  "deleted": false,
  "state": {"title": "Improve sign-in"}
}
```

The entire `home` is immutable. Creation has no `previous`; updates name the exact
accepted head event ID. Concurrent writes cannot silently overwrite each other.
A current-head retry is idempotent; stale revisions fail. `deleted=true` is a
terminal tombstone, not a way to free a room or code identity. Archive/close are
state, not moves. References/grouping in `state` confer no permissions.

Task `project` names a live 45010. Optional `parent` names a live task in that same
project; a subtask still gets its own thread in the project channel. Thread roots
must already exist as live top-level ordinary messages with thread metadata.
Legacy roots lacking metadata must be deliberately prepared before adoption.
Claims do not create/move/hide messages. Channel homes must be non-ephemeral;
expired rooms cannot support durable identity.

Project/repository claims compete for one channel slot. Task/document claims
compete for one thread slot. Branches may share task or standalone thread roots,
but not document roots. The same repository/ref may register only one home.
Deletion and archival retain all reservations; community deletion purges them.

## Code and legacy compatibility

Repository adoption names `git="30617:<owner hex>:<d>"`. The existing announcement
must have exactly one `buzz-channel` matching the proposed home. Only the Git
owner may adopt it. Replacements of the old announcement are transactionally
fenced against changing that home after adoption. Project/repository grouping
remains many-to-many metadata; it is not adoption.

Branches name a canonical `repository` UUID and a full `refs/heads/...` name.
Registration does **not** create or require a live ref. Git transport, manifests,
protection rules and raw ref lifecycle remain unchanged. Deleting/recreating a ref
does not free its registration. Branch declarations follow the *discussion*
channel audience and contain no code. Repository access does not grant discussion
access, nor vice versa. Registration currently requires an unscoped token plus
`messages:write` and `repos:write`; multi-channel token capabilities are deferred.

Legacy events are not canonical revisions. They cannot update canonical state.
Existing community-global Git metadata remains global: this draft does not claim
to retroactively hide old announcements, patches or manifests, and does not export
private canonical snapshots into legacy kinds. Code read/push authority continues
to use the existing Git gates and the now-immutable adopted binding.

## Persistence and security

A small community-scoped `work_objects` index stores homes, heads and tombstones.
Acceptance atomically writes the signed event and index. Partial unique indexes
reserve channel/thread/code identities across types, even after tombstoning.
A per-community declaration lock serializes CAS and relationship checks; it is a
conservative draft choice, not a generic graph or a new HTTP API. Channel/member
rows are locked against concurrent revocation/archive during commit. HTTP and WS
use shared ingest and normal channel-scoped storage/fanout, with no global fallback.

Generic `state` is intentionally opaque in this draft (not a document CRDT, task
workflow engine or assignee operation protocol). Review should settle typed state,
writer granularity, lifecycle restrictions, and adoption UX before enabling clients.

## Review / follow-up boundary

This is not ready for client rollout. In particular:

- Root deletion/retention and channel lifecycle races still need a complete policy
  and dedicated concurrency coverage. Reservations survive, but deleting a root
  can leave a retained object without a live discussion entry point.
- A repository tombstone retires the *canonical object*, not the Git repository
  or its read credentials. Use the existing repository-channel lifecycle to
  restrict code access; this event is not a code-revocation mechanism.
- Existing generic event edits/moderation, Git announcement deletion/recreation,
  code-access gates, and reference disclosure need further adversarial coverage.
- Private history and count use the production access-scoping helper in the
  regression test. Dedicated private search and live-delivery tests for these
  new kinds, and more tenant-fence/migration behavior tests, remain to be added.
- State events have no thread metadata. Consumers must filter message kinds for
  chat windows rather than treating every channel-scoped event as conversation.
