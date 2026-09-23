# Shared settings for scripts/thread-perf-*. Source, don't execute.
TP_PROJECT=buzz-threadperf
TP_COMPOSE="${REPO_ROOT}/scripts/thread-perf-compose.yml"
TP_PG_PORT=5481
TP_RELAY_PORT=3040
TP_RELAY_URL="http://localhost:${TP_RELAY_PORT}"
TP_DATABASE_URL="postgres://buzz:buzz_dev@localhost:${TP_PG_PORT}/buzz"
TP_STATE_DIR="${REPO_ROOT}/target/thread-perf"
TP_TMUX=buzz-threadperf-relay
tp_compose() { docker compose -p "$TP_PROJECT" -f "$TP_COMPOSE" "$@"; }
tp_psql() { psql "$TP_DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX "$@"; }
