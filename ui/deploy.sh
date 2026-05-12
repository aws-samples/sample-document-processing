#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Sirisha — UI Deployment"
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
echo "[1/5] Verifying AWS credentials..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "ERROR: AWS credentials not configured. Run 'aws configure' or set AWS_PROFILE."
  exit 1
}
REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"

# Install UI dependencies
echo ""
echo "[2/5] Installing UI dependencies..."
npm install --silent

# Build Next.js static export
echo ""
echo "[3/5] Building static site..."
npm run build
echo "  Output: ui/out/"

# Install CDK dependencies
echo ""
echo "[4/5] Installing CDK dependencies..."
cd "$SCRIPT_DIR/infra"
npm install --silent

# Deploy CDK stack (S3 + CloudFront)
echo ""
echo "[5/5] Deploying S3 + CloudFront..."
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json

echo ""
echo "============================================"
echo "  UI Deployment complete!"
echo "  Outputs saved to: ui/infra/cdk-outputs.json"
echo "============================================"
