NIP-AR
======

Channel Artifacts
-----------------

`draft` `optional` `relay`

**Depends on:** NIP-01 (signed events), NIP-29 (channel access).

## Abstract

An **artifact** is a durable, editable record inside a channel, optionally
attached to a conversation within it. This NIP defines a common envelope,
identity, revision chain, access rules, and lifecycle for artifacts with
client-defined content types.

Each artifact has exactly one current home channel, which determines its
audience. Any number of artifacts, including of the same type, may share a
channel or conversation.
Relationships between artifacts organize work without granting access or
operational authority. The relay validates the envelope and lifecycle; clients
interpret and validate content according to its type.

MUST, MUST NOT, SHOULD, and MAY have their RFC 2119 meanings.

## Identity and envelope

Artifact revisions use regular stored event kind **45010**.

Each revision is a complete snapshot, not a field patch. Common tags have
exactly two string elements. Required tags occur exactly once; optional tags at
most once. Duplicate common tags are invalid even if their values agree. The
relay MUST reject more than 256 total tags per revision, including common and
unknown tags. The relay's advertised event-size limit also applies.

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
`-`; total length is at most 128 bytes. `buzz.*` names are reserved by
convention for published Buzz contracts, not proof of trusted authorship.

Identity is `(community, d)`, independent of signer, type, and home. It is not
a NIP-01 addressable coordinate. The relay retains accepted revisions and an
explicit current-head index; neither timestamps nor signer changes select a
winner. `type` and `d` are immutable. A new business-schema version belongs in
the content contract, not in a replacement artifact identity.

Unknown tags are bounded annotations. They MUST NOT override common tags or
confer authority. Business relationship tags are specified by clients, not
resolved or validated by this NIP. Unsupported envelope versions are rejected.
Missing `h` is a rejection, never a fallback to global visibility.

Artifacts remain subject to the relay's storage and write quotas.

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

Artifacts at the same location retain separate identities and revision chains.
Archiving an artifact MUST NOT archive its channel or other artifacts in it.

## Authorization and concurrency

Channel read access controls artifact read access. Threads introduce no
additional audience. This applies to direct-ID lookups, history, current state,
search, counts, previews, exports, and live delivery, within the host-derived
community boundary. No title or relationship metadata may leak through errors
or unreadable search/count results.

“Write permission” means the same authorization that admits a kind-9 message in
that channel: channel membership of any role (including agents/Bot), or open
visibility, plus authentication, token-channel restrictions, moderation, and
archive gates. An otherwise authorized community participant may create/edit in
an open channel without first joining it. “Administration” means Admin/Owner
channel authority under channel authorization rules. Artifact writes require
`channels:write` plus the operation-specific channel checks below.
Clients and agent tokens must request that scope; a numeric member-role
threshold must not exclude agents.

| Operation | Required authority at commit time |
|-----------|------------------------------------|
| Create | Write permission in destination channel |
| Update content, title, or anchor within home | Write permission in current home |
| Delete | Administration in current home; in a DM, participant write permission |
| Move to another channel | Write permission in source AND destination |

Authorization is independent of the artifact's creator. A reader without write
permission cannot edit. Removed members lose write permission in private
channels even if they created the record; an open channel still follows the
open-channel admission rule above. These rules do not vary by `type`.
Authenticated-agent/channel authorization applies; provenance alone must not
create a new grant. Signed authorship remains the actual event signer.

Creation uses `op=create`, no `prev`, and an unused `d`. All subsequent
operations must name the current accepted head in `prev`. Ordinary updates and
deletion must keep `h`; only `move` may change it. A move must actually change
channels. `op` MUST agree with these structural constraints; it cannot disguise
a move as an update or an update as a new creation. The relay checks
permission, previous head, envelope, and anchor, then stores the event and
advances the head in one transaction. Two writes against the same head cannot
both succeed. Knowing `prev` is not edit authorization. On conflict, clients
must refetch the current accessible head and reconcile their intended change,
not blindly retry or silently overwrite newer state. Retrying an accepted event
ID is idempotent; permission to retrieve its contents is still checked.

Rejected writes never enter history, search, or live delivery. Error responses
must not reveal an inaccessible current head or destination. The relay MUST
reject NIP-09 kind-5 requests targeting artifact revisions, with an explicit
reason such as `invalid: use artifact delete operation`; it must not report
successful deletion or release an artifact identity through that path.

Deletion is a terminal tombstone on the same identity, with empty content.
Delete events permit only the common envelope tags and validated
authentication/provenance tags (such as NIP-OA `auth`), not annotation tags.
Its type, `h`, `root`, and title must equal the head it deletes; deletion must
not rename or relocate it. Its type and last title remain under its home
permissions for an unavailable/deleted display. It is absent from active lists;
subscribers receive a removal. Retained history follows retention/moderation
policy; deletion is not a promise to erase downloaded copies. A deleted `d` is
never reused. Business completion/archive is not deletion.

### Direct messages

A DM channel is a valid home. Artifacts inherit its participant access rules.
DM participants are peers: deleting an artifact in a DM requires participant
write permission rather than an Admin/Owner role. The relay MUST determine
channel type from the stored channel, not an artifact tag. This rule applies to
every artifact type.

## Moving and audience changes

Moving preserves identity and publishes a complete current snapshot into the
destination. The UI MUST identify the destination audience and what fields and
context will be shared before confirmation. This includes titles, descriptions,
relationship labels, attachments, and any private material copied into content.
A reference does not automatically authorize copying its resolved contents.

The move revision is scoped to the destination. Its anchor must be absent or
belong to that destination; the old conversation does not move with it.
**Moving an artifact moves zero conversation messages.** Prior revisions stay
under the visibility of the channel in which each was published. A
destination-only reader can load the current snapshot without reading the old
chain. A source-only reader retains access to permitted source history, not
later destination revisions. Moves cannot revoke previously learned data.

One transaction MUST advance the current head and durably record removal from
the source scope and arrival in the destination scope. The destination carries
the client-signed revision. The source receives a separate relay-authenticated
invalidation that binds community, source scope, artifact identity, and replay
position. The invalidation MUST NOT contain the destination channel, title, or
payload. Clients MUST reject invalidations that lack relay authentication.

Publication of both changes MUST be retryable after a crash. A forward link may
resolve only with the requesting reader's destination permissions. Concurrent
edits and moves MUST preserve a single current head. Moving back to a former
home uses that same head and identity.

Channel membership and open/private visibility changes are also audience
changes: artifact access follows channel policy, rather than being frozen to
the membership at creation. Every subsequent read and delivery must honor the
new access policy; clients must invalidate cached views when access is revoked.
Offline copies cannot be recalled; UI must not promise otherwise.

## Current state, history, and sync

Revisions are submitted through signed Nostr event ingestion. Artifact changes
belong in channel/thread sync alongside other scoped changes, but **applied
updates and human read positions are different state**. Receiving an update
neither marks conversation read nor necessarily notifies someone. Explicit
notification policy may call attention to meaningful changes. Clients MUST NOT
count artifact revisions as unread conversation messages.

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
Unsupported predicates must be rejected, never silently ignored. `EOSE` is not
a durable applied checkpoint. A cursor must identify its covered stream/filter;
a filtered result cannot stand in for a complete channel checkpoint.

### Sync transport requirements

A relay advertising support MUST provide a sync transport that satisfies the
current-state, replay, reset, and invalidation requirements above. This NIP
defines their required semantics; the transport's wire format is specified
separately. A relay MUST reject `move` until it supports atomic head
advancement and durable delivery to both scopes. Independent delete/create
writes do not satisfy move semantics.

## Client types and privileged operations

[Artifact client contracts](NIP-AR-CLIENTS.md) define the initial Buzz types.
The relay accepting `type=buzz.task` does not certify a valid task. Clients must
validate before interpreting business fields; unsupported or malformed content
falls back to a safe card. Render title/type as untrusted text, not executable
markup. A type namespace is not a publisher identity or installed capability.

Unknown versions must not be edited destructively. Editors must preserve
unknown content fields and annotation tags when safe, or decline editing that
version. Relations may be missing, inaccessible, deleted, self-referential, or
cyclic. Traversals must be bounded and fail visibly without crashing.

Links and payloads cannot authorize push, merge, membership changes, payments,
or another privileged action. Those actions require their own trusted service
checks. A client-observed status is not a relay-certified operational fact.

## Interoperability

NIP-34 repository announcements (30617), ref state (30618), reviews, patches,
and statuses retain their identities and access rules. An artifact referencing
one of these objects MUST NOT alter its access policy or confer Git authority.
Branch artifacts describe collaboration around a ref; Git state is obtained
from the referenced repository under its own access checks.

A project event (30621) or issue event (1621) is not an artifact revision. A
`buzz-channel` tag on another event kind does not apply this NIP's access or
revision rules to it. Conversion between representations requires an explicit
identity mapping and an authoritative current record; it MUST NOT create two
independently writable representations of the same record. Conversion MUST
preserve references and ownership information, and MUST NOT change access
without authorization.

## Conformance scenarios

Implementations MUST satisfy the following scenarios.

| Scenario | Required result |
|----------|-----------------|
| Two projects or tasks at the same location | Both valid and separately discoverable |
| Task without project or repository | Valid |
| Another channel writer edits an artifact | Valid with current head; author accurately recorded |
| Read-only principal or removed creator in a private home edits | Rejected |
| Non-member permitted to post in an open home edits | Valid under the same message-admission gates |
| A current DM participant deletes an artifact | Valid with participant write permission and current head |
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
