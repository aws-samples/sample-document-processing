"""GET /presigned-url — Create a document record and return an S3 pre-signed upload URL."""

import uuid
import boto3
from botocore.config import Config
from shared.constants import DOCUMENT_BUCKET, REGION, PRESIGNED_URL_EXPIRY
from shared.db import create_document
from shared.response import success, error


s3 = boto3.client("s3", region_name=REGION, config=Config(signature_version="s3v4"))


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    file_name = params.get("fileName")
    customer_name = params.get("customerName")

    if not file_name or not customer_name:
        return error("Missing required parameters: fileName, customerName")

    doc_id = f"doc-{uuid.uuid4().hex[:8]}"
    s3_key = f"uploads/{doc_id}/{file_name}"

    # Create document record in DynamoDB
    doc = create_document({
        "id": doc_id,
        "customerName": customer_name,
        "documentName": file_name,
        "pdfS3Path": f"s3://{DOCUMENT_BUCKET}/{s3_key}",
        "status": "Queued",
    })

    # Generate pre-signed URL for PUT upload
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": DOCUMENT_BUCKET,
            "Key": s3_key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=PRESIGNED_URL_EXPIRY,
    )

    return success({
        "uploadUrl": upload_url,
        "documentId": doc_id,
        "s3Path": f"s3://{DOCUMENT_BUCKET}/{s3_key}",
    })
