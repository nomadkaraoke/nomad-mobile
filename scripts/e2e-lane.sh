# Sourced by scripts/e2e-local.sh, scripts/ci/setup-stacks.sh and scripts/ci/run-shard.sh: the ports and state of
# one E2E "lane", so several runs (each with its own simulator / emulator, Metro and gen + decide + kjbox stacks) can
# share one machine. LANE=0 (default) is today's layout exactly; LANE=N moves every port up by 100·N and gives the
# stacks their own Firestore project (gen's global fake-config lives in Firestore, per project) and state dirs.
#
#   lane 0: gen 8010 · web 3010 · search 8020 · decide 8030 · kjbox 8040 · stack-control 8049 · Metro 8081
#   lane 1: gen 8110 · web 3110 · search 8120 · decide 8130 · kjbox 8140 · stack-control 8149 · Metro 8181
#
# The Firestore (:8080) and GCS (:4443) emulators are shared by every lane. An explicit GEN_PORT, METRO_PORT, … still
# wins. Needs GEN_DIR / DECIDE_DIR set first (for the per-lane state dirs).
LANE="${LANE:-0}"
[[ "$LANE" =~ ^[0-9]$ ]] || { echo "LANE must be 0-9 (got $LANE)" >&2; exit 2; }
_lane_off=$((LANE * 100))
GEN_PORT="${GEN_PORT:-$((8010 + _lane_off))}"
GEN_WEB_PORT="${GEN_WEB_PORT:-$((3010 + _lane_off))}"
SEARCH_PORT="${SEARCH_PORT:-$((8020 + _lane_off))}"
DECIDE_PORT="${DECIDE_PORT:-$((8030 + _lane_off))}"
KJBOX_PORT="${KJBOX_PORT:-$((8040 + _lane_off))}"
CONTROL_PORT="${CONTROL_PORT:-$((8049 + _lane_off))}"
METRO_PORT="${METRO_PORT:-$((8081 + _lane_off))}"
# Per-lane stack env, passed to each stack's script call (gen and decide both read LOCAL_STACK_STATE_DIR, so it is
# never exported). Lane 0 leaves them empty: the scripts' own defaults.
LANE_PROJECT=""; GEN_STATE_DIR=""; DECIDE_STATE_DIR=""; KJBOX_DATA_DIR=""
if (( LANE > 0 )); then
  LANE_PROJECT="test-project-lane$LANE"
  GEN_STATE_DIR="${GEN_DIR:?}/.local-stack-lane$LANE"
  DECIDE_STATE_DIR="${DECIDE_DIR:?}/.local-stack-lane$LANE"
  KJBOX_DATA_DIR="$HOME/kjdata-localstack-lane$LANE"
fi
# `env` arguments for each stack script (empty values are dropped, so lane 0 passes nothing new).
lane_gen_env() {
  local a=(LOCAL_STACK_API_PORT="$GEN_PORT" LOCAL_STACK_WEB_PORT="$GEN_WEB_PORT")
  [[ -n "$LANE_PROJECT" ]] && a+=(LOCAL_STACK_PROJECT="$LANE_PROJECT" LOCAL_STACK_STATE_DIR="$GEN_STATE_DIR")
  printf '%s\n' "${a[@]}"
}
lane_decide_env() {
  local a=(DECIDE_LOCAL_PORT="$DECIDE_PORT" SEARCH_LOCAL_PORT="$SEARCH_PORT" GEN_API_URL="http://127.0.0.1:$GEN_PORT")
  [[ -n "$LANE_PROJECT" ]] && a+=(LOCAL_STACK_PROJECT="$LANE_PROJECT" LOCAL_STACK_STATE_DIR="$DECIDE_STATE_DIR")
  printf '%s\n' "${a[@]}"
}
lane_kjbox_env() {
  local a=(KJBOX_LOCALSTACK_PORT="$KJBOX_PORT" KJBOX_LOCALSTACK_GEN_URL="http://127.0.0.1:$GEN_PORT"
    KJBOX_LOCALSTACK_DECIDE_URL="http://127.0.0.1:$DECIDE_PORT")
  [[ -n "$KJBOX_DATA_DIR" ]] && a+=(KJBOX_LOCALSTACK_DIR="$KJBOX_DATA_DIR")
  printf '%s\n' "${a[@]}"
}
