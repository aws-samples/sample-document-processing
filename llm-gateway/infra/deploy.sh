#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  LLM Gateway - Infrastructure Deployment"
echo "============================================"

# Check prerequisites
for cmd in node npm npx aws docker; do
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

# Verify VPC stack exists
echo ""
echo "[2/4] Checking VPC stack dependency..."
if aws cloudformation describe-stacks --stack-name DocProcessingVpcStack --region "$REGION" &> /dev/null; then
  echo "  DocProcessingVpcStack: OK"
else
  echo "ERROR: DocProcessingVpcStack not found. Deploy vpc/infra first."
  exit 1
fi
if aws cloudformation describe-stacks --stack-name DocProcessingSecurityGroupsStack --region "$REGION" &> /dev/null; then
  echo "  DocProcessingSecurityGroupsStack: OK"
else
  echo "ERROR: DocProcessingSecurityGroupsStack not found. Deploy vpc/infra first."
  exit 1
fi

# Install dependencies
echo ""
echo "[3/4] Installing dependencies..."
npm install --silent

# Deploy stacks
echo ""
echo "[4/4] Deploying stacks..."
echo "  This will create: Aurora Serverless v2, ECS Fargate service, Internal ALB"
echo "  Estimated time: ~10 minutes"
echo ""
npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "  Outputs saved to: llm-gateway/infra/cdk-outputs.json"
echo ""
echo "  Next steps:"
echo "  - Get ALB DNS: cat cdk-outputs.json | grep AlbDnsName"
echo "  - Get admin key: aws secretsmanager get-secret-value --secret-id document-processing/llm-gateway/admin-key --query SecretString --output text"
echo "============================================"
