-- Sessions keep normal channel/message identity. Their optional parent is the
-- authority for membership, never a copied roster that can diverge.
ALTER TABLE channels ADD COLUMN is_session boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN parent_channel_id uuid;
ALTER TABLE channels ADD CONSTRAINT session_parent_same_community
  FOREIGN KEY (community_id, parent_channel_id) REFERENCES channels (community_id, id);
ALTER TABLE channels ADD CONSTRAINT session_parent_shape
  CHECK (parent_channel_id IS NULL OR (is_session AND parent_channel_id <> id));
CREATE INDEX channels_session_parent ON channels (community_id, parent_channel_id)
  WHERE parent_channel_id IS NOT NULL;

CREATE VIEW effective_channel_members AS
  SELECT m.community_id, m.channel_id, m.pubkey, m.role, m.joined_at,
         m.invited_by, m.removed_at, m.removed_by, m.hidden_at FROM channel_members m
  JOIN channels c ON c.community_id = m.community_id AND c.id = m.channel_id
  WHERE c.parent_channel_id IS NULL
  UNION ALL
  SELECT m.community_id, c.id AS channel_id, m.pubkey, m.role,
         m.joined_at, m.invited_by, m.removed_at, m.removed_by, m.hidden_at
  FROM channels c
  JOIN channels p ON p.community_id = c.community_id AND p.id = c.parent_channel_id
  JOIN channel_members m ON m.community_id = p.community_id AND m.channel_id = p.id
  WHERE p.deleted_at IS NULL AND NOT p.is_session;

ALTER TABLE channels ADD CONSTRAINT sessions_are_private CHECK (NOT is_session OR visibility = 'private');

-- Extend the existing freshness fence to inherited rosters.
CREATE OR REPLACE FUNCTION guard_channel_roster_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    parent_id UUID;
    canonical_members TEXT[];
    snapshot_members TEXT[];
BEGIN
    IF NEW.kind <> 39002 OR NEW.channel_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'buzz_channel_membership:' || NEW.community_id::text || ':' || NEW.channel_id::text,
        0
    ));

    -- The child lock serializes moves; the parent lock serializes inherited
    -- membership capture with additions/removals, including administrative kicks.
    SELECT parent_channel_id INTO parent_id FROM channels
     WHERE community_id = NEW.community_id AND id = NEW.channel_id;
    IF parent_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'buzz_channel_membership:' || NEW.community_id::text || ':' || parent_id::text, 0
        ));
    END IF;

    SELECT COALESCE(
               array_agg(encode(cm.pubkey, 'hex') || ':' || cm.role::text ORDER BY cm.pubkey),
               ARRAY[]::TEXT[]
           )
      INTO canonical_members
      FROM effective_channel_members cm
     WHERE cm.community_id = NEW.community_id
       AND cm.channel_id = NEW.channel_id
       AND cm.removed_at IS NULL;

    -- A roster is canonical only when every p tag uses the emitted four-field
    -- shape, contains a 32-byte hex pubkey and valid authoritative role, has no
    -- duplicate members, and exactly matches the active membership rows.
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(NEW.tags) AS roster_tag(tag_json)
         WHERE roster_tag.tag_json->>0 = 'p'
           AND (
               jsonb_array_length(roster_tag.tag_json) <> 4
               OR COALESCE(roster_tag.tag_json->>1, '') !~ '^[0-9a-fA-F]{64}$'
               OR roster_tag.tag_json->>2 <> ''
               OR COALESCE(roster_tag.tag_json->>3, '') NOT IN ('owner', 'admin', 'bot', 'member', 'guest')
           )
    ) THEN
        RAISE EXCEPTION 'kind 39002 roster contains an invalid p tag'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(
               array_agg(
                   lower((roster_tag.tag_json->>1)) || ':' || (roster_tag.tag_json->>3)
                   ORDER BY decode((roster_tag.tag_json->>1), 'hex')
               ),
               ARRAY[]::TEXT[]
           )
      INTO snapshot_members
      FROM jsonb_array_elements(NEW.tags) AS roster_tag(tag_json)
     WHERE roster_tag.tag_json->>0 = 'p';

    IF snapshot_members IS DISTINCT FROM canonical_members THEN
        RAISE EXCEPTION 'kind 39002 roster does not match canonical channel membership'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
