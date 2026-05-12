#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  LLM Gateway — Infrastructure Cleanup"
echo "============================================"

# Check prerequisites
for cmd in node npx aws; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is not installed."
    exit 1
  fi
done

REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

echo ""
echo "[1/3] Installing dependencies..."
npm install --silent

echo ""
echo "[2/3] Destroying CDK stacks (reverse dependency order)..."
echo "  This will remove: Observability dashboard, ECS Fargate service, ALB, Aurora Serverless, Secrets"
echo ""
npx cdk destroy --all --force

echo ""
echo "[3/3] Cleaning up ECR images..."
REPO_NAME="cdk-hnb659fds-container-assets-$(aws sts get-caller-identity --query Account --output text)-${REGION}"
echo "  Note: CDK asset images in ECR repo '${REPO_NAME}' may remain."
echo "  To remove manually: aws ecr delete-repository --repository-name <repo> --force"

echo ""
echo "============================================"
echo "  LLM Gateway infrastructure destroyed."
echo "============================================"
