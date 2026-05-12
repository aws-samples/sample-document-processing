"""POST /workflow/start — Start the Step Functions document processing workflow."""

import json
import boto3
from shared.constants import REGION, WORKFLOW_STATE_MACHINE_ARN
from shared.db import get_document, update_document
from shared.response import success, error


sfn = boto3.client("stepfunctions", region_name=REGION)


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error("Invalid JSON body")

    document_id = body.get("documentId")
    customer_name = body.get("customerName", "")
    user_name = body.get("userName", "sirija")
    schema_type = body.get("schemaType", "invoice")

    if not document_id:
        return error("Missing required field: documentId")

    # Fetch document to get pdfS3Path
    doc = get_document(document_id)
    if not doc:
        return error(f"Document not found: {document_id}", 404)

    pdf_s3_path = doc.get("pdfS3Path", "")

    # Update document status to Processing
    update_document(document_id, {"status": "Processing"})

    # Start Step Functions execution if configured
    if WORKFLOW_STATE_MACHINE_ARN:
        sfn_input = {
            "documentId": document_id,
            "pdfS3Path": pdf_s3_path,
            "customerName": customer_name,
            "userName": user_name,
            "schemaType": schema_type,
        }
        sfn.start_execution(
            stateMachineArn=WORKFLOW_STATE_MACHINE_ARN,
            name=document_id,
            input=json.dumps(sfn_input),
        )

    return success({"documentId": document_id, "status": "Processing"})
