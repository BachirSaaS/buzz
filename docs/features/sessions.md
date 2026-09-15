# Channel-backed work sessions (initial protocol)

This local implementation adds saved work conversations without changing ordinary
channel/message identity. Deployment requires migration `0045_sessions.sql` and
all serving relay pods upgraded before clients enable child sessions.
`BUZZ_ENABLE_SESSIONS` defaults to false and gates both command acceptance and
capability advertisement. Old pods cannot read inherited membership. Roll the
new image to the whole fleet with creation disabled, verify every pod, then
enable the switch in a second rollout. Updated pods with the switch off still
authorize and serve existing sessions. The ACP type-label change is compatible with existing private
channel routing. NIP-11 advertises `buzz-sessions-v1` only on an enabled new
relay; clients must gate creation on that extension.

## Commands

A signed kind **9050** event has exactly one `h` tag containing the session UUID.
An optional trailing `client-id` tag may contain one canonical UUID for outbox
retries; it grants no authority.
Content is a JSON object of at most 2048 UTF-8 bytes, with no unknown fields:

- Create: `{"action":"create","title":"Work topic","parent_id":null}`.
  The parent is optional; title must contain 1–120 characters after nonempty
  validation. The client chooses a UUID before sending and retains the signed
  event ID for retries.
- Move: `{"action":"move","parent_id":"<uuid>","confirm_history":true}`.
  Only a standalone owner can move. The destination must be an active stream or
  forum in the same community, and the actor and all session participants must
  already belong to it. Confirmation acknowledges full-history disclosure and
  replacement of independent access.

Normal signature, principal, ban/timeout, and ChannelsWrite checks apply.
Channel-restricted tokens are rejected for these initial commands, so a token
cannot share history beyond its allowed channels. State and signed receipt commit
atomically. Exact retries require current session access and repair discovery.

## Access and discovery

Storage remains a private stream with `is_session=true`; discovery emits
`["t","session"]` and, for a child, `["parent","<uuid>"]`. No `hidden` tag is
used: existing ACP treats hidden private groups as DMs.

Standalone membership uses normal private-channel invitations/roles. A child's
current membership and roles come entirely from its parent through
`effective_channel_members`. Former standalone membership does not grant access.
Child roster edits are rejected. Parent removals and deletion revoke child access;
cache invalidation and parent discovery/roster notifications propagate to children.
Sessions stay private, including through generic metadata edits.

A `session_timeline:true` bridge filter with a single `#h` reads bounded keyset
history including replies. Existing aux, summaries, and signed bounds apply;
ordinary `top_level:true` channel reads keep their current behavior. Non-session
IDs are rejected for this extension.

## Initial limits and validation

Moving between parents or out of a parent is not implemented. People/agent
invitations use existing membership policy; detailed agent activity stays owner-only.
No shared runner or shared activity feed is introduced.

The PostgreSQL test lane discovers `sessions::postgres_tests`. Both migration
and desired-state tests exercise create/retry, move, missing members,
unauthorized/cross-community attempts, reply paging, and revocation. They also
publish an inherited 39002 through the production replacement guard, reject an
empty physical roster, and prove the parent membership lock remains held until
publication. The desired-state path must use pgschema plus the repository's
post-apply reconciliation script.

The relay integration test uses signed events through the HTTP router and
`ingest_event` with local Redis: parent invitation, child creation with an outbox identifier, rejected
unauthorized creation, accepted retry, prompt/reply, parent removal and denied
later sends. It also exercises the durable admin kick outbox against a warm child
access cache and verifies the child removal notification. Administrative kicks
directly against children are rejected; administrators must target the parent.

A second relay state with session creation disabled reads the signed conversation
window through authenticated HTTP. Its warmed child-access cache receives a real
Redis membership invalidation after parent removal, and the subsequent HTTP read
is denied. A separate test checks that the rollout switch gates both signed
creation and NIP-11 advertisement. These tests pass in both migration and
pgschema desired-state modes. The two states share a test process; this does not
establish multi-pod WebSocket delivery or recovery from Redis failure.

Local verification on 2026-09-15 (initial checks at `a9dd4d3bd`; subsequently
fast-forwarded over mobile-only changes to `5b9dbcb4c`):

- Relay and ACP compilation passed.
- Migrated and pgschema-created database session tests passed.
- Signed relay integration with local PostgreSQL/Redis passed.
- Focused parser/cache tests and PostgreSQL discovery checks passed.

These checks do not establish production readiness. Full repository validation,
WebSocket client end-to-end testing, multi-pod Redis invalidation/failure
recovery, and actual ACP agent execution remain before rollout. Keep child
creation gated in the production frontend until the shared backend is released.

## Production rollout boundary

The local frontend at port 1431 uses the production identity and relay, but does
not change the production relay binary. Enabling a frontend flag cannot add the
9050 command or inherited database access to that relay.

Review and integrate this backend branch, then build an immutable relay image
using the repository release process and deploy it through the existing
production infrastructure workflow. Apply migration 0045 without rewriting any
previous migration. Keep `BUZZ_ENABLE_SESSIONS=false` until every serving pod supports the
extension, including any traffic-serving canary. Enable it in a separate
configuration rollout after verifying the image identities.
Verify NIP-11, signed creation, discovery, prompt/reply, and parent removal before
reopening child creation. Old binaries must not serve child sessions after any
have been created: they only understand physical memberships. A rollback after
creation requires a coordinated access-preserving plan, not an image-only swap.
