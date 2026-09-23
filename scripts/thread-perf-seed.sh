#!/usr/bin/env bash
# Seed an isolated PG16 + relay stack with one long thread plus background
# event volume, for reproducing slow long-thread loads (see thread-perf-bench.sh).
#
#   scripts/thread-perf-seed.sh up             # fresh stack + schema + relay
#   scripts/thread-perf-seed.sh relay <tree>   # rebuild + restart the bench relay from worktree <tree>
#   scripts/thread-perf-seed.sh thread         # channel, root, 187 replies, 22 reactions (via relay ingest)
#   scripts/thread-perf-seed.sh volume <rows>  # grow background events to <rows> total, then ANALYZE
#   scripts/thread-perf-seed.sh all [rows]     # up + thread + volume (default 1000000)
#   scripts/thread-perf-seed.sh clean          # merge every GIN pending list (VACUUM ANALYZE)
#   scripts/thread-perf-seed.sh dirty [pages]  # refill each partition's GIN pending list to ~pages (default 400)
#   scripts/thread-perf-seed.sh down           # stop relay, remove containers and volume
#
# Aux-query plans and timings depend on GIN pending-list state; bench reports
# record it per partition. 'volume' leaves lists dirty (ANALYZE doesn't merge).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=thread-perf-env.sh
source scripts/thread-perf-env.sh

REPLIES="${TP_REPLIES:-187}"
REACTIONS="${TP_REACTIONS:-22}"
log() { echo "[thread-perf] $*" >&2; }

up() {
  if lsof -nP -iTCP:"$TP_RELAY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "port $TP_RELAY_PORT busy; run 'down' first"; exit 1
  fi
  for bin in buzz buzz-admin; do
    [[ -x "target/release/$bin" ]] || { log "build first: cargo build --release -p buzz-relay -p buzz-cli -p buzz-admin"; exit 1; }
  done
  tp_compose up -d --wait postgres redis minio
  tp_compose run --rm minio-init >/dev/null
  tp_psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  # Migrations (not schema.sql): prod's events GIN index (migrations/0004) and
  # other migration-only objects must exist or the planner sees a different DB.
  DATABASE_URL="$TP_DATABASE_URL" ./target/release/buzz-admin migrate >/dev/null
  tp_psql -c "INSERT INTO communities (host) VALUES ('localhost:${TP_RELAY_PORT}') ON CONFLICT DO NOTHING;"
  tp_psql -c "CREATE EXTENSION IF NOT EXISTS pgstattuple;"
  relay "$REPO_ROOT"
}

# (Re)start the bench relay from <worktree>, rebuilt there, with a clean env
# (env -i: no inherited READ_DATABASE_URL etc.) on loopback only. Stops the
# previous bench relay by the exact PID in its manifest, then writes
# relay.json (pid, source commit, dirty flag, binary sha256) for the bench.
relay() {
  local src bin key old pid
  src="$(cd "${1:?worktree required}" && pwd)"
  mkdir -p "$TP_STATE_DIR"
  if [[ -f "$TP_STATE_DIR/relay.json" ]]; then
    old="$(jq -r .pid "$TP_STATE_DIR/relay.json")"
    if [[ "$(ps -o comm= -p "$old" 2>/dev/null)" == *buzz-relay ]]; then
      log "stopping bench relay pid $old"; kill "$old"
      while kill -0 "$old" 2>/dev/null; do sleep 0.2; done
    fi
  fi
  if lsof -nP -iTCP:"$TP_RELAY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "port $TP_RELAY_PORT held by a process not in relay.json; stop it by PID first"; exit 1
  fi
  (cd "$src" && cargo build --release -p buzz-relay)
  bin="$src/target/release/buzz-relay"
  [[ -f "$TP_STATE_DIR/relay.key" ]] || openssl rand -hex 32 > "$TP_STATE_DIR/relay.key"
  key="$(cat "$TP_STATE_DIR/relay.key")"
  tmux kill-session -t "$TP_TMUX" 2>/dev/null || true
  # tmux joins argv into one shell string, so launch via a generated script.
  cat > "$TP_STATE_DIR/relay.sh" <<SH
#!/bin/sh
cd '$src' && exec env -i PATH=/usr/bin:/bin HOME='$HOME' RUST_LOG=info \\
  DATABASE_URL='$TP_DATABASE_URL' REDIS_URL=redis://127.0.0.1:6481 \\
  RELAY_URL='ws://localhost:$TP_RELAY_PORT' BUZZ_BIND_ADDR='127.0.0.1:$TP_RELAY_PORT' \\
  BUZZ_HEALTH_PORT=8098 BUZZ_METRICS_PORT=9212 \\
  BUZZ_S3_ENDPOINT=http://127.0.0.1:9481 BUZZ_S3_ACCESS_KEY=buzz_dev \\
  BUZZ_S3_SECRET_KEY=buzz_dev_secret BUZZ_S3_BUCKET=buzz-media \\
  BUZZ_RELAY_PRIVATE_KEY='$key' BUZZ_REQUIRE_AUTH_TOKEN=false \\
  BUZZ_RATE_LIMIT_HUMAN_MESSAGES_PER_MIN=100000 BUZZ_RATE_LIMIT_HUMAN_API_CALLS_PER_MIN=100000 \\
  BUZZ_RATE_LIMIT_AGENT_STANDARD_MESSAGES_PER_MIN=100000 BUZZ_RATE_LIMIT_AGENT_STANDARD_API_CALLS_PER_MIN=100000 \\
  '$bin' > '$TP_STATE_DIR/relay.log' 2>&1
SH
  chmod 700 "$TP_STATE_DIR/relay.sh"
  tmux new-session -d -s "$TP_TMUX" "exec '$TP_STATE_DIR/relay.sh'"
  pid="$(tmux list-panes -t "$TP_TMUX" -F '#{pane_pid}')"
  jq -n --argjson pid "$pid" --arg src "$src" --arg commit "$(git -C "$src" rev-parse HEAD)" \
    --arg dirty "$(git -C "$src" status --porcelain)" \
    --arg bin "$bin" --arg sha "$(shasum -a 256 "$bin" | cut -d' ' -f1)" \
    '{pid:$pid, sourceDir:$src, sourceCommit:$commit, sourceDirty:($dirty != ""), binary:$bin, binarySha256:$sha}' \
    > "$TP_STATE_DIR/relay.json"
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$TP_RELAY_URL/" && { log "relay pid $pid up on $TP_RELAY_URL from $src"; return; }
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  log "relay failed to start; see $TP_STATE_DIR/relay.log"; exit 1
}

thread() {
  local owner_sk channel root id i
  owner_sk="$(openssl rand -hex 32)"
  export BUZZ_RELAY_URL="$TP_RELAY_URL" BUZZ_PRIVATE_KEY="$owner_sk"
  unset BUZZ_AUTH_TAG
  local cli=target/release/buzz
  channel="$($cli channels create --name "thread-perf-$$" --type stream --visibility open | jq -er .channel_id)"
  root="$($cli messages send --channel "$channel" --content "thread-perf root" | jq -er .event_id)"
  local ids=()
  for i in $(seq 1 "$REPLIES"); do
    id="$($cli messages send --channel "$channel" --reply-to "$root" --content "reply $i: $(openssl rand -hex 24)" | jq -er .event_id)"
    ids+=("$id")
  done
  for i in $(seq 1 "$REACTIONS"); do
    $cli reactions add --event "${ids[$(( (i * 7) % REPLIES ))]}" --emoji "👍" >/dev/null
  done
  local owner_pubkey
  owner_pubkey="$(tp_psql -c "SELECT encode(pubkey,'hex') FROM events WHERE id = decode('$root','hex')")"
  jq -n --arg pk "$owner_pubkey" --arg channel "$channel" --arg root "$root" \
    '{owner_pubkey:$pk, channel:$channel, root:$root}' > "$TP_STATE_DIR/thread.json"
  log "thread seeded: channel=$channel root=$root replies=$REPLIES reactions=$REACTIONS"
}

# Background rows bypass triggers (session_replication_role=replica): they are
# inert filler that shapes table size, partition spread, and GIN statistics.
# Most rows share the thread's community (the aux query filters on it), spread
# created_at across every partition, and ~45% carry an ["e", <earlier id>] tag.
volume() {
  local target="$1" have batch
  tp_psql -c "CREATE TABLE IF NOT EXISTS threadperf_meta (bg_rows BIGINT NOT NULL); \
    INSERT INTO threadperf_meta SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM threadperf_meta);" >/dev/null
  have="$(tp_psql -c "SELECT bg_rows FROM threadperf_meta")"
  while (( have < target )); do
    batch=$(( target - have < 1000000 ? target - have : 1000000 ))
    log "inserting background rows $((have + 1))..$((have + batch))"
    tp_psql <<SQL
SET session_replication_role = replica;
WITH c AS (SELECT id AS community_id FROM communities WHERE host = 'localhost:${TP_RELAY_PORT}'),
g AS (
  SELECT n, (n * 2654435761) % 1000 AS r
  FROM generate_series($((have + 1))::bigint, $((have + batch))::bigint) AS n
)
INSERT INTO events (community_id, id, pubkey, created_at, kind, tags, content, sig, channel_id)
SELECT c.community_id,
       sha256(('tp' || n)::bytea),
       sha256(('pk' || (n % 500))::bytea),
       timestamptz '2025-10-01' + ((n * 7919) % 30000000) * interval '1 second',
       CASE WHEN r < 600 THEN 9 WHEN r < 850 THEN 7 WHEN r < 900 THEN 40003
            WHEN r < 930 THEN 5 WHEN r < 960 THEN 30078 ELSE 1 END,
       CASE WHEN r BETWEEN 400 AND 930 AND n > 1
            THEN jsonb_build_array(
                   jsonb_build_array('h', md5('ch' || (n % 200))::uuid::text),
                   jsonb_build_array('e', encode(sha256(('tp' || (1 + (n * 40503) % (n - 1)))::bytea), 'hex')))
            ELSE jsonb_build_array(jsonb_build_array('h', md5('ch' || (n % 200))::uuid::text)) END,
       'background message ' || n,
       '\x00'::bytea,
       md5('ch' || (n % 200))::uuid
FROM g CROSS JOIN c;
UPDATE threadperf_meta SET bg_rows = bg_rows + ${batch};
SQL
    have=$(( have + batch ))
  done
  log "ANALYZE events"
  tp_psql -c "ANALYZE events;"
  tp_psql -c "SELECT tableoid::regclass, count(*) FROM events GROUP BY 1 ORDER BY 1;" >&2
}

pending() {
  tp_psql -c "SELECT c.relname, s.pending_pages, s.pending_tuples FROM pg_inherits i
    JOIN pg_index x ON x.indrelid = i.inhrelid JOIN pg_class c ON c.oid = x.indexrelid
    JOIN pg_am a ON a.oid = c.relam AND a.amname = 'gin' AND c.relname LIKE '%\_tags\_idx', pgstatginindex(c.oid) s
    WHERE i.inhparent = 'events'::regclass ORDER BY 1;" >&2
}

partitions() { tp_psql -c "SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'events'::regclass ORDER BY 1"; }

# Delete dirty filler (its own community, so thread-community volume is
# untouched), re-enable autovacuum, and merge every pending list.
clean() {
  local p
  tp_psql -c "DELETE FROM events WHERE community_id IN (SELECT id FROM communities WHERE host = 'threadperf-dirty');"
  for p in $(partitions); do tp_psql -c "ALTER TABLE $p RESET (autovacuum_enabled);"; done
  tp_psql -c "VACUUM (ANALYZE) events;"
  pending
}

# Insert e-tagged filler into a separate community, per partition, in small
# batches until pgstatginindex reports >= pages pending. Autovacuum is disabled
# on the partitions so it cannot merge the lists; 'clean' restores it.
# Stays under gin_pending_list_limit (4MB = 512 pages), which would self-merge.
dirty() {
  local pages="$1" p idx at n=0 have
  (( pages < 500 )) || { log "pages must be < 500 (4MB gin_pending_list_limit)"; exit 1; }
  tp_psql -c "CREATE EXTENSION IF NOT EXISTS pgstattuple;
    INSERT INTO communities (host) SELECT 'threadperf-dirty'
      WHERE NOT EXISTS (SELECT 1 FROM communities WHERE host = 'threadperf-dirty');"
  for p in $(partitions); do
    tp_psql -c "ALTER TABLE $p SET (autovacuum_enabled = false);"
    idx="$(tp_psql -c "SELECT x.indexrelid::regclass FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
      JOIN pg_am a ON a.oid = c.relam AND a.amname = 'gin' AND c.relname LIKE '%\_tags\_idx' WHERE x.indrelid = '$p'::regclass")"
    at="$(tp_psql -c "SELECT created_at FROM $p LIMIT 1")"
    have="$(tp_psql -c "SELECT pending_pages FROM pgstatginindex('$idx')")"
    while (( have < pages )); do
      tp_psql >/dev/null <<SQL
SET session_replication_role = replica;
INSERT INTO events (community_id, id, pubkey, created_at, kind, tags, content, sig, channel_id)
SELECT c.id, sha256(('dirty' || '$p' || ($n + g))::bytea), sha256(('pk' || (g % 500))::bytea),
       timestamptz '$at', 7,
       jsonb_build_array(jsonb_build_array('h', md5('ch' || (g % 200))::uuid::text),
                         jsonb_build_array('e', encode(sha256(('tp' || g)::bytea), 'hex'))),
       'dirty filler', '\x00'::bytea, md5('ch' || (g % 200))::uuid
FROM generate_series(1, 500) g, communities c WHERE c.host = 'threadperf-dirty';
SQL
      n=$(( n + 500 ))
      have="$(tp_psql -c "SELECT pending_pages FROM pgstatginindex('$idx')")"
    done
  done
  tp_psql -c "ANALYZE events;"
  pending
}

down() {
  local pid
  if [[ -f "$TP_STATE_DIR/relay.json" ]]; then
    pid="$(jq -r .pid "$TP_STATE_DIR/relay.json")"
    [[ "$(ps -o comm= -p "$pid" 2>/dev/null)" == *buzz-relay ]] && kill "$pid"
    rm -f "$TP_STATE_DIR/relay.json"
  fi
  tp_compose down -v
}

case "${1:-}" in
  up) up ;;
  relay) relay "${2:?worktree required}" ;;
  thread) thread ;;
  volume) volume "${2:?row count required}" ;;
  all) up; thread; volume "${2:-1000000}" ;;
  clean) clean ;;
  dirty) dirty "${2:-400}" ;;
  down) down ;;
  *) sed -n 2,15p "$0"; exit 1 ;;
esac
