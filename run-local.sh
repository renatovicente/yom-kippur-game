#!/usr/bin/env bash
# Executa o jogo localmente em http://localhost:8080
set -euo pipefail
cd "$(dirname "$0")/web"
PORTA="${1:-8080}"
echo "A Guerra do Yom Kippur — http://localhost:${PORTA}"
echo "(Ctrl+C para encerrar)"
command -v open >/dev/null && open "http://localhost:${PORTA}" || true
exec python3 -m http.server "${PORTA}"
