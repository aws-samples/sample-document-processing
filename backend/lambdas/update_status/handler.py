"""PATCH /documents/{id}/status — Update document status (Approve/Reject)."""

import json
from shared.db import get_document, update_document
from shared.response import success, error

VALID_TRANSITIONS = {
    "In Review": ["Approved", "Rejected"],
    "Rejected": ["In Review"],  # allow re-review
}


def handler(event, context):
    doc_id = (event.get("pathParameters") or {}).get("id")
    if not doc_id:
        return error("Missing document ID")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error("Invalid JSON body")

    new_status = body.get("status")
    if not new_status:
        return error("Missing required field: status")

    doc = get_document(doc_id)
    if not doc:
        return error("Document not found", 404)

    current_status = doc.get("status", "")
    allowed = VALID_TRANSITIONS.get(current_status, [])
    if new_status not in allowed:
        return error(
            f"Cannot transition from '{current_status}' to '{new_status}'. "
            f"Allowed: {allowed}"
        )

    updated = update_document(doc_id, {"status": new_status})
    return success(updated)
