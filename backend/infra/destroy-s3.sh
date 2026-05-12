#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="document-processing-${ACCOUNT_ID}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${RED}[WARN]${NC}  $*"; }

echo "============================================"
echo "  S3 Document Bucket — Cleanup"
echo "============================================"
echo ""
warn "This will PERMANENTLY DELETE the S3 bucket and ALL its contents:"
echo "  Bucket: s3://${BUCKET}"
echo ""

read -p "Are you sure? This cannot be undone. (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# ── Remove KMS key alias ─────────────────────────────────────────────────────

CMK_ALIAS="alias/document-processing-s3"
info "Scheduling KMS key for deletion (30-day waiting period)..."
CMK_ID=$(aws kms describe-key --key-id "$CMK_ALIAS" --query 'KeyMetadata.KeyId' --output text 2>/dev/null || true)
if [ -n "$CMK_ID" ] && [ "$CMK_ID" != "None" ]; then
  aws kms schedule-key-deletion --key-id "$CMK_ID" --pending-window-in-days 7 2>/dev/null || true
  aws kms delete-alias --alias-name "$CMK_ALIAS" 2>/dev/null || true
  info "KMS key ${CMK_ID} scheduled for deletion in 7 days"
else
  info "No CMK found with alias ${CMK_ALIAS}"
fi

# ── Remove IAM policy from AgentCore role ────────────────────────────────────

ROLE_NAME="AmazonBedrockAgentCoreSDKRuntime-us-east-1-4dbcbeee46"
info "Removing S3 access policy from AgentCore role..."
aws iam delete-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "S3DocumentProcessingAccess" 2>/dev/null || true

# ── Empty and delete bucket ──────────────────────────────────────────────────

info "Emptying bucket (including versioned objects)..."
aws s3 rm "s3://${BUCKET}" --recursive 2>/dev/null || true

# Delete versioned objects and delete markers
info "Removing versioned objects and delete markers..."
aws s3api list-object-versions --bucket "$BUCKET" --output json 2>/dev/null | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
objects = []
for v in data.get('Versions', []):
    objects.append({'Key': v['Key'], 'VersionId': v['VersionId']})
for d in data.get('DeleteMarkers', []):
    objects.append({'Key': d['Key'], 'VersionId': d['VersionId']})
if objects:
    # Batch delete in groups of 1000
    for i in range(0, len(objects), 1000):
        batch = objects[i:i+1000]
        print(json.dumps({'Objects': batch, 'Quiet': True}))
" | while read -r batch; do
  echo "$batch" | aws s3api delete-objects --bucket "$BUCKET" --delete file:///dev/stdin 2>/dev/null || true
done

info "Deleting bucket..."
aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"

echo ""
echo "============================================"
echo "  S3 bucket '${BUCKET}' deleted."
echo "============================================"
