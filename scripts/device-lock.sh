#!/usr/bin/env bash
# Local device lock: one session at a time per simulator / emulator / USB device on this Mac, so parallel Claude
# sessions queue instead of breaking each other's Maestro runs. scripts/e2e-local.sh takes the lock itself (not on
# CI); use this CLI to hold a device for anything else (a manual check, the iPad, the Pixel).
#
#   scripts/device-lock.sh status                    # who holds what
#   scripts/device-lock.sh acquire ipad "phase 6 IAP check"   # wait until free, then hold (until release / reboot)
#   scripts/device-lock.sh release ipad
#   scripts/device-lock.sh run android-emulator-5554 -- <cmd …>   # hold only while <cmd> runs
#
# Keys are free-form: e2e-local.sh uses ios-<simulator UDID>, android-<serial>, and maestro-ios-driver (Maestro
# before 2.2 used a fixed iOS driver port, 7001, so two iOS runs collided even on different simulators).
# A lock whose holder process is gone is taken over. LOCK_WAIT (seconds, default 7200) bounds the wait.
# Locks live in ~/.nomad-device-locks/<key>/ (owner file: pid, session, started, what).
set -euo pipefail

LOCK_ROOT="${NOMAD_DEVICE_LOCK_DIR:-$HOME/.nomad-device-locks}"

_lock_dir() { printf '%s/%s' "$LOCK_ROOT" "${1//[^A-Za-z0-9._-]/_}"; }

# The holder's pid is alive (and, for a held "acquire", the lock is kept until release).
_lock_alive() {
  local owner="$1/owner" pid
  [[ -f "$owner" ]] || return 1
  pid="$(sed -n 's/^pid=//p' "$owner")"
  [[ "$pid" == held ]] && return 0
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# device_lock_acquire KEY WHAT [PID]: wait for KEY, then hold it for PID (default: the caller's shell; "held" =
# until released).
device_lock_acquire() {
  local key="$1" what="${2:-}" pid="${3:-$$}" dir waited=0 limit="${LOCK_WAIT:-7200}" said=""
  dir="$(_lock_dir "$key")"
  mkdir -p "$LOCK_ROOT"
  while ! mkdir "$dir" 2>/dev/null; do
    if ! _lock_alive "$dir"; then
      rm -rf "$dir"
      continue
    fi
    if [[ -z "$said" ]]; then
      echo "device-lock: $key is busy ($(tr '\n' ' ' <"$dir/owner")); waiting…" >&2
      said=1
    fi
    (( waited >= limit )) && { echo "device-lock: gave up on $key after ${limit}s" >&2; return 1; }
    sleep 5
    waited=$((waited + 5))
  done
  printf 'pid=%s\nsession=%s\nstarted=%s\nwhat=%s\n' "$pid" "${CLAUDE_SESSION_NAME:-${TMUX_PANE:-$(tty 2>/dev/null || echo ?)}}" \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$what" >"$dir/owner"
  [[ -n "$said" ]] && echo "device-lock: got $key after ${waited}s" >&2
  return 0
}

device_lock_release() {
  local dir
  dir="$(_lock_dir "$1")"
  rm -rf "$dir"
}

device_lock_status() {
  local d any=""
  for d in "$LOCK_ROOT"/*/; do
    [[ -d "$d" ]] || continue
    any=1
    if _lock_alive "${d%/}"; then printf '%-40s %s\n' "$(basename "$d")" "$(tr '\n' ' ' <"$d/owner")"
    else printf '%-40s (stale: holder gone)\n' "$(basename "$d")"; fi
  done
  [[ -n "$any" ]] || echo "no device locks held"
}

# Sourced by e2e-local.sh: only the functions.
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

case "${1:-}" in
  status) device_lock_status ;;
  acquire) [[ -n "${2:-}" ]] || { echo "usage: $0 acquire KEY [WHAT]" >&2; exit 2; }; device_lock_acquire "$2" "${3:-}" held ;;
  release) [[ -n "${2:-}" ]] || { echo "usage: $0 release KEY" >&2; exit 2; }; device_lock_release "$2" ;;
  run)
    key="${2:-}"; shift 2 || true
    [[ "${1:-}" == -- ]] && shift
    [[ -n "$key" && $# -gt 0 ]] || { echo "usage: $0 run KEY -- CMD…" >&2; exit 2; }
    device_lock_acquire "$key" "$*"
    trap 'device_lock_release "$key"' EXIT
    "$@"
    ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
