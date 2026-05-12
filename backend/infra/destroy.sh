#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Backend — Infrastructure Cleanup"
echo "============================================"

# Check prerequisites
for cmd in node npx aws; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is not installed."
    exit 1
  fi
done

echo ""
echo "[1/2] Installing dependencies..."
npm install --silent

echo ""
echo "[2/2] Destroying CDK stacks..."
echo "  This will remove: API Gateway (REST + WebSocket), Lambda functions, DynamoDB tables"
echo ""
npx cdk destroy --all --force

echo ""
echo "============================================"
echo "  Backend infrastructure destroyed."
echo "============================================"
