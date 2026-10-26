#!/bin/sh
# Stint's MCP server for Muse Code: board, packets, memory and decisions as tools.
if command -v stint >/dev/null 2>&1; then exec stint mcp; fi
echo "Stint MCP: the stint command is not on PATH, so Stint's tools are not available." >&2
exit 1
