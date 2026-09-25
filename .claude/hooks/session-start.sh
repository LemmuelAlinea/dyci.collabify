#!/bin/bash
# Cloud containers start fresh: put the codegraph CLI back and rebuild the index.
# Local machines keep both, so this does nothing there.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

export CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1
command -v codegraph >/dev/null || npm i -g @colbymchenry/codegraph >/dev/null 2>&1
cd "$CLAUDE_PROJECT_DIR"
[ -d .codegraph ] || codegraph init >/dev/null 2>&1
