#!/usr/bin/env bash
# macOS / Linux launcher. On Windows use:  start.bat   or   .\start.ps1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PYTHONPATH="$ROOT/backend"

# Load env
if [ -f "$ROOT/.env" ]; then set -a; # shellcheck disable=SC1091
  source "$ROOT/.env"; set +a; fi

API_PORT="${API_PORT:-8000}"
UI_PORT="${UI_PORT:-3000}"

if ss -tln 2>/dev/null | grep -q ":${UI_PORT} "; then
  UI_PORT=3001
  echo "Port 3000 busy — UI will use ${UI_PORT}"
fi

if ss -tln 2>/dev/null | grep -q ":${API_PORT} "; then
  fuser -k "${API_PORT}/tcp" 2>/dev/null || true
  sleep 0.4
fi

PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  PY="$ROOT/.venv/bin/python"
fi

cd "$ROOT/backend"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
BACK_PID=$!

cd "$ROOT/frontend"
if [ ! -d node_modules ]; then npm install; fi
npm run dev -- --hostname 127.0.0.1 --port "$UI_PORT" &
FRONT_PID=$!

echo ""
echo "Gift City AIF Forward Tester"
echo "  API  http://127.0.0.1:${API_PORT}/docs   (pid $BACK_PID)"
echo "  UI   http://127.0.0.1:${UI_PORT}        (pid $FRONT_PID)"
echo ""
trap 'kill $BACK_PID $FRONT_PID 2>/dev/null || true' EXIT
wait
