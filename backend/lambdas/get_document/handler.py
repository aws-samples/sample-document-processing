"""GET /documents/{id} — Get a single document with its extracted data from S3."""

import json
import boto3
from shared.constants import DOCUMENT_BUCKET, REGION
from shared.db import get_document
from shared.response import success, error


s3 = boto3.client("s3", region_name=REGION)


def handler(event, context):
    doc_id = (event.get("pathParameters") or {}).get("id")
    if not doc_id:
        return error("Missing document ID")

    doc = get_document(doc_id)
    if not doc:
        return error("Document not found", 404)

    # If the document has an output path, fetch the extracted data from S3
    output_path = doc.get("outputS3Path", "")
    if output_path and not doc.get("extractedData"):
        try:
            # Parse s3://bucket/key
            path = output_path.replace("s3://", "")
            bucket = path.split("/", 1)[0]
            key = path.split("/", 1)[1]
            resp = s3.get_object(Bucket=bucket, Key=key)
            extracted = json.loads(resp["Body"].read().decode("utf-8"))

            # The agent may write the full validation wrapper
            # {validatedJson: {...}, issues: [...], isValid: bool}
            # instead of just the extracted data — unwrap if needed.
            if isinstance(extracted, dict) and "validatedJson" in extracted:
                extracted = extracted["validatedJson"]

            doc["extractedData"] = extracted
        except Exception as e:
            print(f"Failed to read extracted data from {output_path}: {e}")
            # Return doc without extracted data

    return success(doc)
