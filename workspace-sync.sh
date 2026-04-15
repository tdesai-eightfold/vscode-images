#!/bin/sh
# Sync workspace folder to S3 every 30 seconds, and Continue IDE sessions to
# {REMOTE}.private/sessions/ on the same interval (local: /home/candidate/.continue/sessions).
# Uses S3 Access Grants credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
# injected by creator for candidate-code/hash-{GROUP_ID}/{CONTAINER_HASH}/ via S3_WORKSPACE_PREFIX (3hr token).
#
# S3_WORKSPACE_PREFIX is set to "candidate-code/hash-{group_id}" by the creator so this
# script syncs to s3://{bucket}/{S3_WORKSPACE_PREFIX}/{CONTAINER_HASH}/
#
# Test on Mac: WORKSPACE_SRC=/path/to/folder WORKSPACE_SYNC_ONCE=1 CONTAINER_HASH=test123 \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=... ./workspace-sync.sh
#
# WORKSPACE_SYNC_RCLONE_VERBOSE=1 — add rclone -vv (very verbose) for CloudWatch/debug; default is quieter.
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
WORKSPACE_SYNC_RCLONE_VERBOSE="${WORKSPACE_SYNC_RCLONE_VERBOSE:-0}"

export RCLONE_CONFIG_WORKSPACE_TYPE=s3
export RCLONE_CONFIG_WORKSPACE_PROVIDER=AWS
export RCLONE_CONFIG_WORKSPACE_ENV_AUTH=true
export RCLONE_CONFIG_WORKSPACE_REGION="$REGION"
export RCLONE_CONFIG_WORKSPACE_BUCKET="$BUCKET"
REMOTE="workspace:${BUCKET}/${PREFIX}/${CONTAINER_HASH}/"
# Continue session history → REMOTE.private/sessions/ (override with CONTINUE_SESSIONS_SRC)
SRC_SESSIONS="${CONTINUE_SESSIONS_SRC:-/home/candidate/.continue/sessions}"
REMOTE_SESSIONS="${REMOTE}.private/sessions/"

if [ ! -d "$SRC" ]; then
  echo "Source directory $SRC does not exist; skipping workspace sync" >&2
  exit 0
fi

echo "Workspace sync: $SRC -> $REMOTE (every ${INTERVAL}s)"
echo "Continue sessions sync: $SRC_SESSIONS -> $REMOTE_SESSIONS (every ${INTERVAL}s, skipped if missing)"

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

_rclone_verbose_flags() {
  RCLONE_EXTRA=""
  RCLONE_LOG="--log-level ERROR"
  if [ "$WORKSPACE_SYNC_RCLONE_VERBOSE" = "1" ]; then
    RCLONE_EXTRA="-vv"
    RCLONE_LOG=""
  fi
}

_do_sync() {
  _rclone_verbose_flags
  # Do not hide stderr: AWS/S3 errors must appear in logs (e.g. expired session token).
  if rclone sync "$SRC" "$REMOTE" \
    --filter-from "$FILTER_FROM_FILE" \
    --s3-upload-concurrency 4 \
    $RCLONE_EXTRA \
    $RCLONE_LOG; then
    : # success
  else
    echo "rclone sync failed (will retry)" >&2
    return 1
  fi
}

# No workspace_ignore filters; optional path (skip until Continue creates it).
_do_sync_sessions() {
  _rclone_verbose_flags
  if [ ! -d "$SRC_SESSIONS" ]; then
    return 0
  fi
  if rclone sync "$SRC_SESSIONS" "$REMOTE_SESSIONS" \
    --s3-upload-concurrency 4 \
    $RCLONE_EXTRA \
    $RCLONE_LOG; then
    : # success
  else
    echo "rclone sync (Continue sessions) failed (will retry)" >&2
    return 1
  fi
}

_run_sync_round() {
  _do_sync || true
  _do_sync_sessions || true
}

if [ "$ONCE" = "1" ]; then
  _do_sync
  _workspace_sync_status=$?
  _do_sync_sessions || true
  exit "$_workspace_sync_status"
fi
while true; do
  _run_sync_round
  sleep "$INTERVAL"
done
