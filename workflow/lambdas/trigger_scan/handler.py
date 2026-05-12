"""Step 1: Register task token for GuardDuty malware scan callback.

GuardDuty Malware Protection for S3 automatically scans objects on upload.
This Lambda stores the Step Functions task token so the EventBridge callback
(process_scan_result) can resume the execution when the scan completes.

Handles the race condition where GuardDuty may complete the scan before this
Lambda runs: after storing the token, it checks if a scan result has already
arrived and completes the callback immediately if so.
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
    Input from Step Functions:
    {
        "documentId": "doc-abc12345",
        "pdfS3Path": "s3://bucket/uploads/doc-abc12345/file.pdf",
        "taskToken": "<sfn-task-token>"
    }
    """
    document_id = event["documentId"]
    pdf_s3_path = event["pdfS3Path"]
    task_token = event["taskToken"]

    # Parse S3 key from path — used by process_scan_result to match events
    s3_key = pdf_s3_path.replace("s3://", "").split("/", 1)[1]

    # Atomically store task token and retrieve any pre-arrived scan result
    response = token_table.update_item(
        Key={"scanId": s3_key},
        UpdateExpression="SET documentId = :did, taskToken = :tt, pdfS3Path = :path",
        ExpressionAttributeValues={
            ":did": document_id,
            ":tt": task_token,
            ":path": pdf_s3_path,
        },
        ReturnValues="ALL_NEW",
    )
    item = response.get("Attributes", {})

    # Check if GuardDuty already delivered the scan result (race condition)
    scan_result = item.get("scanResult")
    if scan_result:
        print(f"Scan result already available for {s3_key}: {scan_result}. Completing callback immediately.")
        _send_callback(task_token, document_id, pdf_s3_path, scan_result)
        token_table.delete_item(Key={"scanId": s3_key})
        return {"documentId": document_id, "status": "COMPLETED_IMMEDIATELY"}

    print(f"Stored task token for {s3_key}, waiting for GuardDuty scan result.")
    return {"documentId": document_id, "status": "WAITING_FOR_SCAN"}


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
