#!/bin/sh
# So candidate only sees their own processes in ps (hide root/code-server from ps aux)
mount -o remount,hidepid=2 /proc 2>/dev/null || true
# Code-server runs as root; ACLs let candidate write to workspace (mkdir etc.)
setfacl -R -m u:candidate:rwx /home/candidate/workspace 2>/dev/null || true
setfacl -R -d -m u:candidate:rwx /home/candidate/workspace 2>/dev/null || true
# Start rclone workspace sync to S3 in background (every 30s) when CONTAINER_HASH is set (root-only)
# workspace-sync inherits AWS_* from this process; child keeps its copy after unset
/root/workspace-sync.sh &
# Remove credentials from this process so code-server and terminal never see them
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

# Code-server runs under runuser; root env is not forwarded by default. Pass gallery JSON explicitly.
# Do not use ${VAR:=...} with JSON: the first "}" in the default truncates POSIX parameter expansion.
EXTENSIONS_GALLERY_DEFAULT='{"serviceUrl":"","itemUrl":"","controlUrl":"","recommendationsUrl":""}'
EXTENSIONS_GALLERY="${EXTENSIONS_GALLERY:-$EXTENSIONS_GALLERY_DEFAULT}"
CS_DISABLE_PROXY="${CS_DISABLE_PROXY:-}"
CS_DISABLE_GETTING_STARTED_OVERRIDE="${CS_DISABLE_GETTING_STARTED_OVERRIDE:-}"

# Drop to candidate — cannot overwrite root:root files or chmod-555 directories
exec runuser -u candidate -- /usr/bin/env \
  EXTENSIONS_GALLERY="$EXTENSIONS_GALLERY" \
  CS_DISABLE_PROXY="$CS_DISABLE_PROXY" \
  CS_DISABLE_GETTING_STARTED_OVERRIDE="$CS_DISABLE_GETTING_STARTED_OVERRIDE" \
  "$@"
