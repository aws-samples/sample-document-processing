"""GET /documents — List all documents, sorted by creation date (newest first)."""

from shared.db import list_documents
from shared.response import success


def handler(event, context):
    docs = list_documents()
    return success(docs)
