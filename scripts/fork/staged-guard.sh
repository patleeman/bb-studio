#!/bin/sh
# Source before any bb CLI call, script or curl against a staged or test copy:
#   export BB_SERVER_URL=http://127.0.0.1:<scratch port> BB_DATA_DIR=<scratch dir>
#   . scripts/fork/staged-guard.sh || exit 1
# Refuses when either is unset, when BB_SERVER_URL is the live port 38986
# (BB_PROD_SERVER_PORT; agent shells inherit it), or when BB_DATA_DIR is
# ~/.bb or ~/.bb-studio.
_sg_err=""
[ -n "$BB_SERVER_URL" ] || _sg_err="BB_SERVER_URL is not set (point it at the scratch server)"
[ -z "$_sg_err" ] && [ -z "$BB_DATA_DIR" ] && _sg_err="BB_DATA_DIR is not set (point it at the scratch data dir)"
case "$BB_SERVER_URL" in *:38986*) _sg_err="BB_SERVER_URL points at the live port 38986" ;; esac
case "$BB_DATA_DIR" in "$HOME/.bb" | "$HOME/.bb/"* | "$HOME/.bb-studio" | "$HOME/.bb-studio/"*) _sg_err="BB_DATA_DIR points at a live data dir" ;; esac
if [ -n "$_sg_err" ]; then
  echo "staged-guard: REFUSED: $_sg_err" >&2
  unset _sg_err
  return 1 2>/dev/null || exit 1
fi
unset _sg_err
export BB_SERVER_URL BB_DATA_DIR
echo "staged-guard: ok ($BB_SERVER_URL, $BB_DATA_DIR)"
