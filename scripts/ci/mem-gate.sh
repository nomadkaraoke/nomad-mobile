#!/usr/bin/env bash
# Self-hosted runner: wait until the machine has room for another emulator / simulator before booting one. Three lanes
# share the Mac's 36 GB with the dev-client builds; an emulator booted while another lane's xcodebuild ran froze at boot
# ("detected a hanging thread 'QEMU2 CPU0 thread'") and its shard hung until the job timeout (nightly 2026-10-30).
#
#   scripts/ci/mem-gate.sh [MIN_MB] [MAX_WAIT_S]   # default 5000 MB available, wait up to 900 s, then go on anyway
#
# Available = free + inactive + speculative + purgeable pages (what macOS can hand out without swapping). Linux: MemAvailable.
set -euo pipefail

min_mb="${1:-${E2E_MIN_FREE_MB:-5000}}"
max_wait="${2:-${E2E_MEM_WAIT_S:-900}}"

available_mb() {
  if [[ -r /proc/meminfo ]]; then
    awk '/^MemAvailable:/ { printf "%d\n", $2 / 1024 }' /proc/meminfo
    return
  fi
  vm_stat | awk '
    /page size of/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) size = $i }
    /^Pages (free|inactive|speculative|purgeable):/ { gsub(/\./, "", $NF); pages += $NF }
    END { printf "%d\n", pages * size / 1048576 }'
}

waited=0
while :; do
  have="$(available_mb)"
  if (( have >= min_mb )); then
    (( waited == 0 )) || echo "mem-gate: ${have} MB available after ${waited}s"
    exit 0
  fi
  if (( waited >= max_wait )); then
    echo "mem-gate: only ${have} MB available after ${waited}s (want ${min_mb}); going on anyway" >&2
    exit 0
  fi
  (( waited == 0 )) && echo "mem-gate: ${have} MB available, waiting for ${min_mb} MB (another lane is building or booting)"
  sleep 10
  waited=$((waited + 10))
done
