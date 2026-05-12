#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  VPC — Infrastructure Cleanup"
echo "============================================"
echo ""
echo "  WARNING: The VPC stack must be destroyed LAST."
echo "  All other stacks depend on it. Ensure you have"
echo "  destroyed ui, llm-gateway, workflow, and backend first."
echo ""

# Check prerequisites
for cmd in node npx aws; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is not installed."
    exit 1
  fi
done

read -p "Are you sure you want to destroy the VPC and all networking? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "[1/2] Installing dependencies..."
npm install --silent

echo ""
echo "[2/2] Destroying CDK stacks..."
echo "  This will remove: VPC, subnets, NAT Gateway, security groups, bastion host"
echo ""
npx cdk destroy --all --force

echo ""
echo "============================================"
echo "  VPC infrastructure destroyed."
echo "============================================"
