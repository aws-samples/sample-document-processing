#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="document-processing-${ACCOUNT_ID}"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }

# ── Create bucket ────────────────────────────────────────────────────────────

info "Creating S3 bucket: ${BUCKET}"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    info "Bucket already exists"
else
    aws s3api create-bucket \
        --bucket "$BUCKET" \
        --region "$REGION"
    info "Bucket created"
fi

# ── Block public access ─────────────────────────────────────────────────────

info "Enabling public access block"
aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# ── Enable versioning ───────────────────────────────────────────────────────

info "Enabling versioning"
aws s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled

# ── Enable server-side encryption with CMK ───────────────────────────────────

info "Creating/retrieving KMS CMK for bucket encryption"
CMK_ALIAS="alias/document-processing-s3"
CMK_ARN=$(aws kms describe-key --key-id "$CMK_ALIAS" --query 'KeyMetadata.Arn' --output text 2>/dev/null || true)

if [ -z "$CMK_ARN" ] || [ "$CMK_ARN" = "None" ]; then
    CMK_ARN=$(aws kms create-key \
        --description "CMK for document-processing S3 bucket encryption at rest" \
        --query 'KeyMetadata.Arn' --output text)
    aws kms create-alias --alias-name "$CMK_ALIAS" --target-key-id "$CMK_ARN"
    aws kms enable-key-rotation --key-id "$CMK_ARN"
    info "Created CMK: ${CMK_ARN}"
else
    info "Using existing CMK: ${CMK_ARN}"
fi

info "Enabling KMS default encryption with CMK"
aws s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration "{
        \"Rules\": [{\"ApplyServerSideEncryptionByDefault\": {\"SSEAlgorithm\": \"aws:kms\", \"KMSMasterKeyID\": \"${CMK_ARN}\"}, \"BucketKeyEnabled\": true}]
    }"

# ── Create prefix structure with placeholder objects ─────────────────────────
# S3 doesn't have real folders — we create zero-byte markers so the structure
# is visible in the console and in code conventions.

PREFIXES=(
    "uploads/"          # Incoming PDFs from the UI / API
    "chunks/"           # PDF chunks produced by the chunking agent
    "extraction/"       # Per-chunk extraction results
    "output/"           # Final validated JSON output
    "config/schemas/"   # Output schemas (one JSON file per document type)
    "config/lookups/"   # Lookup/reference data (one JSON file per lookup table)
)

info "Creating prefix structure"
for prefix in "${PREFIXES[@]}"; do
    aws s3api put-object \
        --bucket "$BUCKET" \
        --key "$prefix" \
        --content-length 0 \
        > /dev/null
    echo "  s3://${BUCKET}/${prefix}"
done

# ── Upload sample schema and lookups ─────────────────────────────────────────

CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../config" && pwd)"

info "Uploading schemas and lookups from ${CONFIG_DIR}"
aws s3 sync "${CONFIG_DIR}/schemas/" "s3://${BUCKET}/config/schemas/" --content-type application/json
aws s3 sync "${CONFIG_DIR}/lookups/" "s3://${BUCKET}/config/lookups/" --content-type application/json

# ── Grant AgentCore execution role access ────────────────────────────────────

ROLE_NAME="AmazonBedrockAgentCoreSDKRuntime-us-east-1-4dbcbeee46"

info "Adding S3 access policy to AgentCore execution role"
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "S3DocumentProcessingAccess" \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [
            {
                \"Effect\": \"Allow\",
                \"Action\": [
                    \"s3:GetObject\",
                    \"s3:PutObject\",
                    \"s3:ListBucket\"
                ],
                \"Resource\": [
                    \"arn:aws:s3:::${BUCKET}\",
                    \"arn:aws:s3:::${BUCKET}/*\"
                ]
            }
        ]
    }"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
info "S3 infrastructure ready"
echo ""
echo "  Bucket:  s3://${BUCKET}"
echo "  Schemas: s3://${BUCKET}/config/schemas/<doc_type>.json"
echo "  Lookups: s3://${BUCKET}/config/lookups/<lookup_name>.json"
echo "  Uploads: s3://${BUCKET}/uploads/<doc_id>/<filename>.pdf"
echo "  Output:  s3://${BUCKET}/output/<doc_id>/result.json"
