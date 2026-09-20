NIP-AR
======

Channel Artifacts
-----------------

`draft` `optional` `relay` `not implemented`

**Depends on:** NIP-01 (signed events), NIP-29 (channel access).

## Decision

An **artifact** is a durable, editable record inside a channel, optionally
attached to a conversation within it. Channels contain artifacts; they are not
artifacts themselves. Projects, tasks, and branch collaboration records use the
same envelope, with client-defined content types.

- One current home channel determines an artifact's current audience.
- Any number of artifacts, including of the same type, may share a location.
- Relationships organize work; they never grant access or operational authority.
- The relay validates the common envelope and lifecycle, not business schemas.
- Clients share published contracts for first-party types; unknown types remain
  readable as a basic card.

This replaces the conversation-subject proposal in
[PR #7656](https://github.com/block/buzz/pull/7656): no exclusive/primary claims,
no type-specific event kinds or relay relationship validation, no required
project for a task, and no permanently fixed home. This is a specification PR,
not a claim that these behaviors are available in existing clients or relays.

MUST, MUST NOT, SHOULD, and MAY have their RFC 2119 meanings.

## Identity and envelope

The proposal uses one regular stored event kind, **45010**, for all artifact
revisions. This number is proposed, not allocated by this docs-only change;
implementation must reserve it in `crates/buzz-core/src/kind.rs`. It replaces,
not interoperates with, the unshipped project-kind proposal using that number.

Each revision is a complete snapshot, not a field patch. Common tags have
exactly two string elements. Required tags occur exactly once; optional tags at
most once. Duplicate common tags are invalid even if their values agree. The
relay MUST reject more than 256 total tags per revision, including common and
unknown tags; its advertised event-size limit also applies.

| Tag | Count | Meaning |
|-----|-------|---------|
| `ar` | 1 | Envelope version, initially `1` |
| `d` | 1 | Stable artifact UUID: canonical lowercase, hyphenated, non-nil |
| `h` | 1 | Current home channel UUID, same encoding |
| `root` | 0..1 | Conversation anchor event ID, 64 lowercase hex characters |
| `prev` | 0..1 | Immediately preceding accepted revision ID, 64 lowercase hex characters |
| `type` | 1 | Namespaced content type, e.g. `buzz.task` |
| `title` | 1 | Non-whitespace display title, at most 512 UTF-8 bytes |
| `op` | 1 | `create`, `update`, `move`, or `delete` |

`content` is opaque UTF-8 to the relay, subject to the relay's advertised event
size and rate limits. Type names are lowercase ASCII dot-separated components,
each starting with a letter and otherwise containing letters, digits, `_`, or
`-`; total length is at most 128 bytes. `buzz.*` names are reserved by convention
for published Buzz contracts, not proof of trusted authorship.

Identity is `(community, d)`, independent of signer, type, and home. It is not a
NIP-01 addressable coordinate. The relay retains accepted revisions and an
explicit current-head index; neither timestamps nor signer changes select a
winner. `type` and `d` are immutable. A new business-schema version belongs in
the content contract, not in a replacement artifact identity.

Unknown tags are bounded annotations. They MUST NOT override common tags or
confer authority. Business relationship tags are specified by clients, not
resolved or validated by this NIP. Unsupported envelope versions are rejected.
Missing `h` is a rejection, never a fallback to global visibility.

The existing canvas kind (40100) provides a channel-scoped, non-chat precedent;
see `required_scope_for_kind` and `requires_h_channel_scope` in
`crates/buzz-relay/src/handlers/ingest.rs`. Artifact implementation must explicitly
join that scoped class, not `is_global_only_kind`. Kind allocation alone does
not establish unread, quota, or fan-out behavior: implementation must audit and
test those paths. Artifacts remain subject to bounded storage/write quotas even
though they do not count as chat messages.

## Conversations and multiple artifacts

Without `root`, the artifact lives directly in its channel. When supplied or
changed, `root` must identify an existing, live (not deleted at commit time)
conversation anchor in `h` in the same community. An unchanged anchor may
subsequently become unavailable without preventing edits to the artifact.
Clients must retain an unavailable-discussion state and allow an authorized
writer to choose another anchor.

A nested conversation may be an anchor; its existing ancestry does not change.
Replies use the conversation's existing protocol, not the latest artifact
revision ID. An artifact revision is not a chat reply and MUST NOT increment
reply counters, chat-message counts, or unread-chat state.

There is no exclusive slot, primary slot, or per-type singleton. Two tasks in
one thread are two records, not competing declarations of what the thread is. A
preferred card, pin, or dedicated workspace is a presentation choice, not
uniqueness or authority. Archiving one project MUST NOT archive its channel or
other artifacts in it.

## Authorization and concurrency

Channel read access controls artifact read access. Threads introduce no
additional audience. This applies to direct-ID lookups, history, current state,
search, counts, previews, exports, and live delivery, within the host-derived
community boundary. No title or relationship metadata may leak through errors or
unreadable search/count results.

The proposed generic write policy is **channel collaboration**. “Write
permission” means the same authorization that admits a kind-9 message in that
channel: channel membership of any role (including agents/Bot), or open
visibility, plus existing authentication, token-channel restrictions,
moderation, and archive gates. It is not a `MemberRole` threshold. Thus an
otherwise authorized community participant may create/edit in an open channel
without first joining it. “Administration” means Admin/Owner channel authority
under existing channel checks. Implementation must choose the artifact API scope
consistently across clients; message-equivalent channel authority must not
exclude agents.

| Operation | Required authority at commit time |
|-----------|------------------------------------|
| Create | Write permission in destination channel |
| Update content, title, or anchor within home | Write permission in current home |
| Delete | Administration permission in current home |
| Move to another channel | Write permission in source AND destination |

Being an artifact's creator is attribution, not a permanent exclusive editing
right. A reader without write permission cannot edit. Removed members lose
write permission in private channels even if they created the record; an open
channel still follows the open-channel admission rule above. These rules do not vary by
`type` and do not introduce per-artifact access lists or plugin-defined rules.
Existing authenticated-agent/channel authorization applies; provenance alone
must not create a new grant. Signed authorship remains the actual event signer.

Creation uses `op=create`, no `prev`, and an unused `d`. All subsequent operations
must name the current accepted head in `prev`. Ordinary updates and deletion
must keep `h`; only `move` may change it. A move must actually change channels.
`op` MUST agree with these structural constraints; it cannot disguise a move as
an update or an update as a new creation.
The relay checks permission, previous head, envelope, and anchor, then stores
the event and advances the head in one transaction. Two writes against the
same head cannot both succeed. Knowing `prev` is not edit authorization.
On conflict, clients must refetch the current accessible head and reconcile
their intended change, not blindly retry or silently overwrite newer state. Retrying an accepted event ID is idempotent;
permission to retrieve its contents is still checked.

Rejected writes never enter history, search, or live delivery. Error responses
must not reveal an inaccessible current head or destination. The relay MUST reject NIP-09
kind-5 requests targeting artifact revisions, with an explicit reason such as
`invalid: use artifact delete operation`; it must not report successful deletion
or release an artifact identity through that path.

Deletion is a terminal tombstone on the same identity, with empty content.
Delete events permit only the common envelope tags and the existing validated
authentication/provenance tags (such as NIP-OA `auth`), not annotation tags.
This generic allowlist removes relationships without recognizing business types.
Its type, `h`, `root`, and title must equal the head it deletes; deletion must
not rename or relocate it. Its type and last title remain under its home
permissions for an unavailable/deleted display. It is absent from active lists;
subscribers receive a removal. Retained history follows retention/moderation
policy; deletion is not a promise to erase downloaded copies. A deleted `d` is
never reused. Business completion/archive is not deletion.

## Moving and audience changes

Moving preserves identity and publishes a complete current snapshot into the
destination. The UI MUST identify the destination audience and what fields and
context will be shared before confirmation. This includes titles, descriptions,
relationship labels, attachments, and any private material copied into content.
A reference does not automatically authorize copying its resolved contents.

The move revision is scoped to the destination. Its anchor must be absent or
belong to that destination; the old conversation does not move with it. **Moving
an artifact moves zero conversation messages.** Prior revisions stay under the
visibility of the channel in which each was published. A destination-only reader
can load the current snapshot without reading the old chain. A source-only
reader retains access to permitted source history, not later destination
revisions. Moves cannot revoke previously learned data.

One commit must advance the single head and durably record changes for both
scopes: removal/invalidation in the source and arrival in the destination. These
are two scoped change records, not one signed event pretending to have two `h`
values. The destination carries the client-signed revision; the source uses a
relay-authenticated invalidation in the platform sync change envelope. That
envelope must bind community, source scope, artifact identity, and replay
position, with no destination payload. If transported as a Nostr event instead,
it requires a separately allocated relay-only sidecar kind and rejection of
client-authored substitutes. Its wire schema is a sync-integration release gate,
not an already allocated part of kind 45010. Publication must be retryable after
a crash. The source removal must not contain the destination channel, title, or
payload; a forward link may resolve only with the requesting reader's
destination permissions. Concurrent edits/moves cannot create two active copies.
Moving back to a former home still uses the one current head.

Channel membership and open/private visibility changes are also audience
changes: artifact access follows channel policy, rather than being frozen to the
membership at creation. Every subsequent read and delivery must honor the new
access policy; clients must invalidate cached views when access is revoked.
Offline copies cannot be recalled; UI must not promise otherwise.

## Current state, history, and sync

Use the generic signed-event ingestion path, not artifact-specific CRUD APIs.
Artifact changes belong in channel/thread sync alongside other scoped changes,
but **applied updates and human read positions are different state**. Receiving
an update neither marks conversation read nor necessarily notifies someone.
Explicit notification policy may call attention to meaningful changes. Clients
MUST NOT add the artifact kind to conversational-unread kind sets; rendering a
card alongside `root` is a separate presentation decision.

A compliant implementation must offer:

1. Bounded, authorized current-state queries without replaying all revisions or
   conversation history, including for a newly joined destination after a move.
2. Explicit revision-history queries, distinct from current-state listing.
3. Snapshot-to-live handoff with no gaps, durable replay after disconnect,
   tombstones/removals, and a reset/snapshot path for expired checkpoints.
4. Current-head filtering before pagination and counting. A task removed from
   project P must not still match P because an older revision carried its tag.
5. Aggregate-view invalidation for transitions OUT of a filter, not just events
   that still match it. This includes project/assignee/anchor changes, moves, deletion,
   and revoked access. No previously inaccessible content may be disclosed.
6. Bounded discovery of readable artifacts across channels; loading a task list
   must not require opening every thread. Channel visibility still gates results.

Multi-character tag filters are a Buzz extension, not portable NIP-01 behavior.
Unsupported predicates must be rejected, never silently ignored. `EOSE` is not a
durable applied checkpoint. A cursor must identify its covered stream/filter; a
filtered result cannot stand in for a complete channel checkpoint.

**Implementation boundary:** this draft specifies those observable guarantees,
not a second sync protocol. The current-state query mode, snapshot/checkpoint
wire shape, move-removal delivery, and expired-cursor/reset response must be
bound to the platform sync specification before implementing or advertising NIP-
AR support. Ordinary timestamp-sorted `REQ` history alone does not satisfy this
contract. Until move delivery is supported, relays must reject `move`, not
approximate it as independent delete/create writes.

## Client types and privileged operations

[Artifact client contracts](NIP-AR-CLIENTS.md) define the initial Buzz types.
The relay accepting `type=buzz.task` does not certify a valid task. Clients must
validate before interpreting business fields; unsupported or malformed content
falls back to a safe card. Render title/type as untrusted text, not executable
markup. A type namespace is not a publisher identity or installed capability.

Unknown versions must not be edited destructively. Editors must preserve unknown
content fields and annotation tags when safe, or decline editing that version.
Relations may be missing, inaccessible, deleted, self-referential, or cyclic.
Traversals must be bounded and fail visibly without crashing.

Links and payloads cannot authorize push, merge, membership changes, payments,
or another privileged action. Those actions require their own trusted service
checks. A client-observed status is not a relay-certified operational fact.

## Existing Git and project objects

This proposal does not create a second Git repository or replace NIP-34
identity. Repository announcements (30617), ref state (30618), reviews, patches,
and their statuses remain their existing protocol objects. Branch artifacts
describe collaboration around a ref, not authoritative Git state.

**Legacy exception, not completed consolidation:** existing global
project/issue/ repository objects do not acquire private channel reads or
channel sync simply because they contain `buzz-channel`. A push binding alone is
insufficient. NIP-34 read, search, clone/fetch, preview, and live-delivery
scoping require a separate coordinated migration before promising private
repository workspaces. This draft does not tighten or widen existing Git access
as a side effect.

Existing 30621 projects and 1621 issues must not be dual-written as competing
new artifacts. Migration requires an explicit canonical mapping and cutover,
retaining old links, ownership information, and existing access until changed
through an authorized migration. Previously published data cannot be made secret
retroactively. No automatic conversion is specified here.

## Acceptance scenarios

These are implementation requirements, not tests claimed to pass in this PR.

| Scenario | Required result |
|----------|-----------------|
| Two projects or tasks at the same location | Both valid and separately discoverable |
| Task without project or repository | Valid |
| Another channel writer edits an artifact | Valid with current head; author accurately recorded |
| Read-only principal or removed creator in a private home edits | Rejected |
| Non-member permitted to post in an open home edits | Valid under the same message-admission gates |
| Two revisions race on one head | Exactly one accepted |
| A task joins/leaves a project in another channel | Same identity/home; both affected views refresh; no access grant |
| Malformed known type or unknown type/version | Safe fallback; no destructive edit |
| Cyclic parent references | Bounded client handling; relay does not walk the graph |
| Move races edit; relay crashes after commit | One head; durable source removal and destination arrival |
| Destination member cannot read source | Can load current state, not source history |
| Source member cannot read destination | Receives removal, not destination metadata |
| Access revoked while a request is in flight | No newly unauthorized delivery; stale local view invalidated |
| Reconnect after deletion or filter exit | No ghost current records |
| Background revision arrives | State updates; chat unread/read position unchanged |
| Generic repository tag on a task | No push, clone, review, or membership capability gained |

## Non-goals and naming

No per-artifact audience lists, relay-executed plugins, schema-registration
service, generic automation engine, or one-record-per-room requirement. Existing Buzz DMs are channels: an artifact with their `h` inherits participant
access just like their messages (see `handle_dm_open` in
`crates/buzz-relay/src/handlers/command_executor.rs`). This is not a new DM ACL.
Administrative deletion remains gated by actual channel administration; merely
being a DM participant does not manufacture that role. Personal/no-room artifacts
need a separately specified scope; missing `h` must not become an accidental
global/private mode.

“Artifact” is the protocol/design term. User interfaces should usually say
“task,” “project,” or the specific type name. “Work item” sounds task-specific;
“card” describes a presentation. Neither is a better common identity name.
Build-output artifacts/files remain distinct from these editable records.