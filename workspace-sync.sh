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
_do_sync() {
  if rclone sync "$SRC" "$REMOTE" --s3-upload-concurrency 4 --log-level ERROR 2>/dev/null; then
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
