-- Durable home reservations survive event deletion/retention and tombstones.
CREATE TABLE work_objects (
    community_id UUID NOT NULL REFERENCES communities(id),
    object_id TEXT NOT NULL,
    kind INT NOT NULL CHECK (kind IN (45010, 45011, 45012, 45014)),
    channel_id UUID NOT NULL,
    root_id BYTEA,
    git_coordinate TEXT,
    branch_ref TEXT,
    home JSONB NOT NULL,
    head BYTEA NOT NULL CHECK (length(head) = 32),
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (community_id, object_id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels(community_id, id),
    CHECK ((kind IN (45012, 45014)) = (root_id IS NOT NULL)),
    CHECK ((kind IN (45011, 45014)) = (git_coordinate IS NOT NULL)),
    CHECK ((kind = 45014) = (branch_ref IS NOT NULL))
);
CREATE UNIQUE INDEX work_objects_channel_slot ON work_objects(community_id, channel_id)
    WHERE kind IN (45010, 45011);
CREATE UNIQUE INDEX work_objects_thread_slot ON work_objects(community_id, root_id)
    WHERE kind = 45012;
CREATE UNIQUE INDEX work_objects_git_identity ON work_objects(community_id, git_coordinate)
    WHERE kind = 45011;
CREATE UNIQUE INDEX work_objects_branch_identity ON work_objects(community_id, git_coordinate, branch_ref)
    WHERE kind = 45014;
SELECT attach_community_write_fence('work_objects'::regclass);
