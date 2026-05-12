#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Document Processing — Workflow Deployment"
echo "============================================"

# Check prerequisites
for cmd in node npm npx aws; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is not installed. Please install it first."
    exit 1
  fi
done

# Verify AWS credentials
echo ""
echo "[1/3] Verifying AWS credentials..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "ERROR: AWS credentials not configured. Run 'aws configure' or set AWS_PROFILE."
  exit 1
}
REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"

# Install CDK dependencies
echo ""
echo "[2/3] Installing CDK dependencies..."
cd "$SCRIPT_DIR/infra"
npm install --silent

# Deploy CDK stack
echo ""
echo "[3/3] Deploying Step Functions + Lambda + EventBridge..."
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json

echo ""
echo "============================================"
echo "  Workflow Deployment complete!"
echo "  Outputs saved to: workflow/infra/cdk-outputs.json"
echo "============================================"
