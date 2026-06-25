#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  CURSOR CHAT STUDIO"
echo "============================================"
echo

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "Đang lấy bản mới nhất từ GitHub..."
  git pull || true
  echo
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[LỖI] Chưa cài Node.js. Tải tại https://nodejs.org (bản LTS) rồi chạy lại."
  exit 1
fi

echo "Mở trình duyệt: http://localhost:4173"
echo "Nhấn Ctrl+C để tắt server."
echo
exec node server.js
