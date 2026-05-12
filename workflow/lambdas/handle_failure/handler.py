"""Error handler: Update document status to Failed and notify WebSocket.

Catch-all error handler invoked by Step Functions Catch blocks when any
step in the workflow fails.
"""

import json
import os
import boto3
from datetime import datetime, timezone
from shared.constants import REGION, DOCUMENTS_TABLE

NOTIFY_FUNCTION_ARN = os.environ.get("NOTIFY_FUNCTION_ARN", "")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)

# Map internal error types to user-friendly messages
ERROR_MESSAGES = {
    "MalwareDetected": "The uploaded file was flagged by the security scan. Please verify the file and try again.",
    "BedrockAgentCore.AccessDeniedException": "The document processing agent could not be reached due to a permissions issue. Please contact support.",
    "BedrockAgentCore.ServiceException": "The document processing agent encountered an internal error. Please try again later.",
    "BedrockAgentCore.ThrottlingException": "The document processing agent is currently busy. Please try again in a few minutes.",
    "Lambda.ServiceException": "A processing step encountered an internal error. Please try again later.",
    "Lambda.TooManyRequestsException": "The system is currently under heavy load. Please try again in a few minutes.",
    "States.Timeout": "Processing took too long and was stopped. Please try with a smaller document or contact support.",
}


def _parse_cause(cause):
    """Extract a readable message from the Step Functions cause string."""
    if not cause:
        return "No additional details available."
    # Cause is often a JSON string with an errorMessage field
    try:
        parsed = json.loads(cause)
        if "errorMessage" in parsed:
            return parsed["errorMessage"]
    except (json.JSONDecodeError, TypeError):
        pass
    return cause


def _get_friendly_message(error_type, cause):
    """Return a user-friendly error message."""
    friendly = ERROR_MESSAGES.get(error_type)
    if friendly:
        return friendly
    # Fallback: use the parsed cause
    parsed = _parse_cause(cause)
    if len(parsed) > 300:
        parsed = parsed[:300] + "..."
    return f"Processing failed: {parsed}"


def handler(event, context):
    """
    Input from Step Functions Catch block:
    {
        "documentId": "doc-abc12345",
        "error": "MalwareDetected",
        "cause": "GuardDuty scan result: THREATS_FOUND ..."
    }
    """
    document_id = event.get("documentId", "unknown")
    error_type = event.get("error", "UnknownError")
    cause = event.get("cause", "No details available")

    now = datetime.now(timezone.utc).isoformat()

    # Determine status based on error type
    if error_type == "MalwareDetected":
        status = "Malware Detected"
    else:
        status = "Failed"

    friendly_message = _get_friendly_message(error_type, cause)
    print(f"Document {document_id} failed: [{error_type}] {cause}")

    # Update document status with both friendly and technical error info
    if document_id != "unknown":
        documents_table.update_item(
            Key={"id": document_id},
            UpdateExpression="SET #status = :status, errorMessage = :friendly, errorDetails = :details, updatedAt = :now",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": status,
                ":friendly": friendly_message,
                ":details": f"{error_type}: {_parse_cause(cause)}",
                ":now": now,
            },
        )

    # Notify WebSocket clients
    if NOTIFY_FUNCTION_ARN:
        payload = {
            "action": "statusUpdate",
            "documentId": document_id,
            "status": status,
            "message": friendly_message,
        }
        lambda_client.invoke(
            FunctionName=NOTIFY_FUNCTION_ARN,
            InvocationType="Event",
            Payload=json.dumps(payload),
        )

    return {
        "documentId": document_id,
        "status": status,
        "error": error_type,
        "message": friendly_message,
    }
