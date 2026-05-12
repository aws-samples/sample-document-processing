"""Step 5: Notify WebSocket — push status update to connected clients.

Invokes the backend's notify_websocket Lambda to broadcast the document
status change to all connected WebSocket clients.
"""

import json
import os
import boto3
from shared.constants import REGION

NOTIFY_FUNCTION_ARN = os.environ.get("NOTIFY_FUNCTION_ARN", "")

lambda_client = boto3.client("lambda", region_name=REGION)


def handler(event, context):
    """
    Input from Step Functions:
    {
        "documentId": "doc-abc12345",
        "customerName": "Pinnacle Financial Group",
        "pdfS3Path": "s3://bucket/uploads/doc-abc12345/file.pdf",
        "status": "In Review",
        "outputS3Path": "s3://bucket/output/doc-abc12345/result.json"
    }
    """
    document_id = event["documentId"]
    customer_name = event.get("customerName", "")
    pdf_s3_path = event.get("pdfS3Path", "")
    status = event.get("status", "In Review")
    output_s3_path = event.get("outputS3Path", "")

    if not NOTIFY_FUNCTION_ARN:
        print("NOTIFY_FUNCTION_ARN not set, skipping WebSocket notification")
        return {"documentId": document_id, "notified": False}

    # Invoke the backend notify Lambda with clean fields only
    payload = {
        "action": "statusUpdate",
        "documentId": document_id,
        "customerName": customer_name,
        "pdfS3Path": pdf_s3_path,
        "status": status,
        "outputS3Path": output_s3_path,
    }

    response = lambda_client.invoke(
        FunctionName=NOTIFY_FUNCTION_ARN,
        InvocationType="Event",
        Payload=json.dumps(payload),
    )

    return {
        "documentId": document_id,
        "notified": True,
        "statusCode": response.get("StatusCode", 0),
    }
