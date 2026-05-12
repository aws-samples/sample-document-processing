#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Document Processing — VPC Infrastructure"
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
echo "[1/4] Verifying AWS credentials..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "ERROR: AWS credentials not configured. Run 'aws configure' or set AWS_PROFILE."
  exit 1
}
REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"

# Install dependencies
echo ""
echo "[2/4] Installing dependencies..."
npm install --silent

# Bootstrap CDK (skip if already bootstrapped)
echo ""
echo "[3/4] Checking CDK bootstrap..."
if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &> /dev/null; then
  echo "  CDK already bootstrapped — skipping."
else
  npx cdk bootstrap "aws://$ACCOUNT_ID/$REGION" --quiet
fi

# Deploy stacks
echo ""
echo "[4/4] Deploying stacks..."
npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "  Outputs saved to: vpc/infra/cdk-outputs.json"
echo "============================================"
