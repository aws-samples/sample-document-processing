"""EventBridge callback: Process GuardDuty S3 malware scan result and resume Step Functions.

Triggered by EventBridge when GuardDuty Malware Protection for S3 completes a scan.
Matches the scanned S3 key to a stored task token and resumes the Step Functions execution.

Handles the race condition where GuardDuty may complete the scan before trigger_scan
has stored the task token: if no token exists yet, the scan result is saved so that
trigger_scan can pick it up and complete the callback.
"""

import json
import os
import boto3
from shared.constants import REGION

TASK_TOKEN_TABLE = os.environ.get("TASK_TOKEN_TABLE", "DocumentProcessing-ScanTaskTokens")

sfn = boto3.client("stepfunctions", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
token_table = dynamodb.Table(TASK_TOKEN_TABLE)


def handler(event, context):
    """
    EventBridge event detail (GuardDuty Malware Protection Object Scan Result):
    {
        "schemaVersion": "1.0",
        "scanStatus": "COMPLETED",
        "resourceType": "S3_OBJECT",
        "s3ObjectDetails": {
            "bucketName": "document-processing-<YOUR_AWS_ACCOUNT_ID>",
            "objectKey": "uploads/doc-abc12345/file.pdf",
            "eTag": "...",
            "versionId": "..."
        },
        "scanResultDetails": {
            "scanResultStatus": "NO_THREATS_FOUND" | "THREATS_FOUND"
        }
    }
    """
    detail = event.get("detail", event)
    print(f"Received scan event: {json.dumps(detail, default=str)}")

    # Extract S3 key from event
    s3_details = detail.get("s3ObjectDetails", {})
    s3_key = s3_details.get("objectKey", "")
    scan_result_details = detail.get("scanResultDetails", {})
    scan_result = scan_result_details.get("scanResultStatus") or scan_result_details.get("scanResult", "UNKNOWN")

    if not s3_key:
        print("No S3 object key in event, skipping.")
        return {"status": "SKIPPED", "reason": "No S3 key in event"}

    # Atomically store the scan result and retrieve any existing task token
    response = token_table.update_item(
        Key={"scanId": s3_key},
        UpdateExpression="SET scanResult = :sr",
        ExpressionAttributeValues={":sr": scan_result},
        ReturnValues="ALL_NEW",
    )
    item = response.get("Attributes", {})

    task_token = item.get("taskToken")
    document_id = item.get("documentId", "")
    pdf_s3_path = item.get("pdfS3Path", "")

    if not task_token:
        # Token not stored yet — trigger_scan will pick up the scanResult when it runs
        print(f"Task token not yet available for s3Key={s3_key}, stored scan result for trigger_scan to pick up.")
        return {"status": "DEFERRED", "reason": "Token not yet stored, scan result saved"}

    # Both token and result are present — complete the callback
    _send_callback(task_token, document_id, pdf_s3_path, scan_result)

    # Clean up
    token_table.delete_item(Key={"scanId": s3_key})

    return {
        "documentId": document_id,
        "scanResult": scan_result,
        "action": "RESUMED" if scan_result == "NO_THREATS_FOUND" else "FAILED",
    }


def _send_callback(task_token, document_id, pdf_s3_path, scan_result):
    """Send task success or failure to Step Functions."""
    if scan_result == "NO_THREATS_FOUND":
        sfn.send_task_success(
            taskToken=task_token,
            output=json.dumps({
                "documentId": document_id,
                "pdfS3Path": pdf_s3_path,
                "scanResult": "CLEAN",
            }),
        )
        print(f"Sent task success for document {document_id}")
    else:
        sfn.send_task_failure(
            taskToken=task_token,
            error="MalwareDetected",
            cause=f"GuardDuty scan result: {scan_result} for document {document_id}",
        )
        print(f"Sent task failure for document {document_id}: {scan_result}")
