"""Step 4: Persist agent results — update DynamoDB and store output path.

Updates the document record with the output S3 path and sets status to 'In Review'.
If the agent didn't write the output to S3, this Lambda uploads it.
"""

import json
import os
import boto3
from datetime import datetime, timezone
from shared.constants import REGION, DOCUMENTS_TABLE, DOCUMENT_BUCKET

dynamodb = boto3.resource("dynamodb", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)


def handler(event, context):
    """
    Input from Step Functions (clean agent response):
    {
        "documentId": "doc-abc12345",
        "customerName": "Pinnacle Financial Group",
        "pdfS3Path": "s3://bucket/uploads/doc-abc12345/file.pdf",
        "outputS3Path": "s3://bucket/output/doc-abc12345/result.json",
        "errors": []
    }
    """
    document_id = event["documentId"]
    customer_name = event.get("customerName", "")
    pdf_s3_path = event.get("pdfS3Path", "")
    output_s3_path = event.get("outputS3Path", "")
    errors = event.get("errors", [])

    now = datetime.now(timezone.utc).isoformat()

    # If agent didn't write to S3, create a placeholder
    if not output_s3_path:
        output_key = f"output/{document_id}/result.json"
        output_s3_path = f"s3://{DOCUMENT_BUCKET}/{output_key}"

        s3.put_object(
            Bucket=DOCUMENT_BUCKET,
            Key=output_key,
            Body=json.dumps({"status": "empty", "errors": errors}, indent=2),
            ContentType="application/json",
        )

    # Update document record with output path and status
    documents_table.update_item(
        Key={"id": document_id},
        UpdateExpression="SET #status = :status, outputS3Path = :outputPath, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "In Review",
            ":outputPath": output_s3_path,
            ":now": now,
        },
    )

    return {
        "documentId": document_id,
        "customerName": customer_name,
        "pdfS3Path": pdf_s3_path,
        "status": "In Review",
        "outputS3Path": output_s3_path,
    }
