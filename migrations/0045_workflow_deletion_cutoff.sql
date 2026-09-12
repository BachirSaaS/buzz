-- Forward-only proof of atomic canonical workflow deletion. Never backfill from
-- legacy kind-5 events: their side effects may not have committed.
CREATE TABLE workflow_deletions (
    community_id UUID NOT NULL REFERENCES communities(id),
    owner_pubkey BYTEA NOT NULL CHECK (octet_length(owner_pubkey) = 32),
    workflow_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    deleted_through TIMESTAMPTZ NOT NULL,
    event_id BYTEA NOT NULL CHECK (octet_length(event_id) = 32),
    PRIMARY KEY (community_id, owner_pubkey, workflow_id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels(community_id, id)
);
SELECT attach_community_write_fence('workflow_deletions');
