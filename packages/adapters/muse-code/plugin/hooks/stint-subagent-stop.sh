#!/bin/sh
# Stint hook for Muse Code: never blocks Muse. Outside a Stint run it does nothing.
[ -n "$STINT_TASK" ] || exit 0
if command -v stint >/dev/null 2>&1; then exec stint hook "SubagentStop"; fi
echo "Stint hook: the stint command is not on PATH. The packet was NOT drafted." >&2
exit 0
