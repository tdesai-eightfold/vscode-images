#!/bin/sh
# Sync workspace folder to S3 every 30 seconds.
# Uses S3 Access Grants credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
# injected by creator for candidate-code/hash-{GROUP_ID}/{CONTAINER_HASH}/ via S3_WORKSPACE_PREFIX (3hr token).
#
# S3_WORKSPACE_PREFIX is set to "candidate-code/hash-{group_id}" by the creator so this
# script syncs to s3://{bucket}/{S3_WORKSPACE_PREFIX}/{CONTAINER_HASH}/
#
# Test on Mac: WORKSPACE_SRC=/path/to/folder WORKSPACE_SYNC_ONCE=1 CONTAINER_HASH=test123 \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=... ./workspace-sync.sh
#
# Rclone --filter-from: https://rclone.org/filtering/ — blacklist-only (- rules); paths that
# match no rule are still transferred. All *.txt files under workspace_ignore/ are merged (LC_ALL=C sort).
set -e

if [ -z "${CONTAINER_HASH}" ]; then
  echo "CONTAINER_HASH not set; skipping workspace sync"
  exit 0
fi
if [ -z "${AWS_SESSION_TOKEN}" ] || [ -z "${AWS_ACCESS_KEY_ID}" ]; then
  echo "AWS credentials not set; skipping workspace sync"
  exit 0
fi
INTERVAL="${WORKSPACE_SYNC_INTERVAL:-30}"
SRC="${WORKSPACE_SRC:-/home/candidate/workspace}"
BUCKET="${S3_WORKSPACE_BUCKET:-candidate-code-688567298444-ap-northeast-1-an}"
GROUP_ID="${GROUP_ID:-eightfold-demo}"
PREFIX="${S3_WORKSPACE_PREFIX:-candidate-code/hash-${GROUP_ID}}"
REGION="${AWS_REGION:-ap-northeast-1}"
ONCE="${WORKSPACE_SYNC_ONCE:-0}"

export RCLONE_CONFIG_WORKSPACE_TYPE=s3
export RCLONE_CONFIG_WORKSPACE_PROVIDER=AWS
export RCLONE_CONFIG_WORKSPACE_ENV_AUTH=true
export RCLONE_CONFIG_WORKSPACE_REGION="$REGION"
export RCLONE_CONFIG_WORKSPACE_BUCKET="$BUCKET"
REMOTE="workspace:${BUCKET}/${PREFIX}/${CONTAINER_HASH}/"

if [ ! -d "$SRC" ]; then
  echo "Source directory $SRC does not exist; skipping workspace sync" >&2
  exit 0
fi

echo "Workspace sync: $SRC -> $REMOTE (every ${INTERVAL}s)"

_workspace_sync_rules_dir() {
  if [ -n "${WORKSPACE_SYNC_RULES_DIR:-}" ]; then
    printf '%s\n' "$WORKSPACE_SYNC_RULES_DIR"
    return
  fi
  d=$(dirname "$0")
  case "$d" in
    /*) ;;
    *) d=$(CDPATH= cd -- "$(dirname "$0")" && pwd) ;;
  esac
  printf '%s\n' "$d/workspace_ignore"
}

RULES_DIR="$(_workspace_sync_rules_dir)"
if [ ! -d "$RULES_DIR" ]; then
  echo "workspace_ignore not found at $RULES_DIR (set WORKSPACE_SYNC_RULES_DIR)" >&2
  exit 1
fi

# Merge every *.txt in lexical order (LC_ALL=C sort). Use a numeric prefix (e.g. 10-common.txt) if order matters.
RULE_TXT_COUNT=0
for rules_path in "$RULES_DIR"/*.txt; do
  [ -f "$rules_path" ] || continue
  RULE_TXT_COUNT=$((RULE_TXT_COUNT + 1))
done
if [ "$RULE_TXT_COUNT" -eq 0 ]; then
  echo "No *.txt filter rules in $RULES_DIR" >&2
  exit 1
fi

FILTER_FROM_FILE=$(mktemp "${TMPDIR:-/tmp}/workspace-sync-filter.XXXXXX")
trap 'rm -f "$FILTER_FROM_FILE"' EXIT INT HUP
(
  for rules_path in "$RULES_DIR"/*.txt; do
    [ -f "$rules_path" ] || continue
    printf '%s\n' "$rules_path"
  done | LC_ALL=C sort | while IFS= read -r rules_path; do
    cat "$rules_path"
  done
) > "$FILTER_FROM_FILE"

_do_sync() {
  if rclone sync "$SRC" "$REMOTE" \
    --filter-from "$FILTER_FROM_FILE" \
    --s3-upload-concurrency 4 \
    --log-level ERROR 2>/dev/null; then
    : # success
  else
    echo "rclone sync failed (will retry)" >&2
    return 1
  fi
}
if [ "$ONCE" = "1" ]; then
  _do_sync
  exit $?
fi
while true; do
  _do_sync || true
  sleep "$INTERVAL"
done
