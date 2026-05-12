from strands import Agent, tool

from src.llm import get_model
from src.tools.pdf import read_pdf_text
from src.tools.s3 import s3_write

_SYSTEM_PROMPT = """\
You are the Extraction Agent in a document processing pipeline.
You receive a PDF chunk reference and a field mapping, then extract ALL data from the chunk.

## Your Tools
- read_pdf_text: Downloads a PDF chunk from S3 and extracts its text content. Call this first.
- s3_write: Writes the extraction result JSON to S3. Call this after extraction.

## Field Mapping Format
The custom_fields array contains field definitions. Each field has:
- fieldKey: the output key — may use dot notation for nested fields (e.g. "vendor.name", "billTo.address")
- fieldType: "string", "number", "integer", "boolean", or "array"
- description: what to look for in the document text
- items (optional): for array fields, defines the sub-fields of each array element

## CRITICAL: Multi-Invoice Handling
A single chunk may contain MULTIPLE invoices. You MUST extract ALL of them.
- Look for invoice number patterns (e.g. INV-001, AC2-2024-00001) to identify invoice boundaries
- Each invoice has its own invoiceNumber, dates, billTo, shipTo, lineItems, totals, etc.
- Vendor info and wireTransfer are shared across invoices — extract once

## Process
1. Call read_pdf_text with the chunk S3 path to get the document text
2. Identify how many invoices are in the chunk
3. Extract vendor info (shared) and wireTransfer (shared) if present
4. For EACH invoice found, extract all per-invoice fields (invoiceNumber, dates, billTo, shipTo, lineItems, totals, notes)
5. Build the extractedData with vendor at top level and an invoices array
6. Write the extraction result to S3 at the temp path
7. Return the result

## Output Format
Return ONLY a JSON object with this exact structure:
{
  "chunkId": "chunk-N",
  "extractedData": {
    "vendor": {"name": "Acme Corp", "address": "123 Main St", ...},
    "invoices": [
      {
        "invoiceNumber": "INV-001",
        "invoiceDate": "2024-01-15",
        "billTo": {"name": "Customer Inc", ...},
        "lineItems": [{"lineNumber": 1, "description": "...", "quantity": 10, ...}],
        "subtotal": 1000.00,
        "totalDue": 1080.00,
        ...
      },
      {
        "invoiceNumber": "INV-002",
        ...
      }
    ],
    "wireTransfer": {"bankName": "...", ...}
  },
  "tempJsonS3Path": "s3://BUCKET/extraction/DOC_ID/extract-chunk-N.json"
}

Rules:
- Extract chunkId from the chunk_s3_path filename (e.g. chunk-0.pdf -> chunkId = "chunk-0")
- Extract BUCKET and DOC_ID from the chunk_s3_path
- Extract ALL invoices in the chunk, not just the first one
- If an invoice spans a chunk boundary (starts in this chunk but is incomplete), still extract what is available
- Vendor and wireTransfer are top-level (shared); everything else goes inside each invoice object
- If vendor or wireTransfer is not in this chunk, set to null
- Return ONLY the JSON object, no markdown fences, no prose
"""


@tool
def extraction_agent(chunk_s3_path: str, custom_fields: str) -> str:
    """Extract field values from a single PDF chunk. Call once per chunk, all calls in parallel.

    Args:
        chunk_s3_path: S3 URI of the chunk, e.g. s3://bucket/chunks/doc-id/chunk-0.pdf
        custom_fields: JSON array of field definitions with fieldKey, fieldType, description

    Returns a small JSON with chunkId and tempJsonS3Path only.
    """
    import json, re

    # Derive chunkId and output S3 path deterministically from the input path
    # Input:  s3://bucket/chunks/doc-id/chunk-N.pdf
    # Output: s3://bucket/extraction/doc-id/extract-chunk-N.json
    path_no_prefix = chunk_s3_path.replace("s3://", "")
    bucket = path_no_prefix.split("/", 1)[0]
    key = path_no_prefix.split("/", 1)[1]
    parts = key.split("/")
    doc_id = parts[1] if len(parts) >= 3 else parts[0]
    filename = parts[-1]
    chunk_id = filename.replace(".pdf", "")
    extract_s3_path = f"s3://{bucket}/extraction/{doc_id}/extract-{chunk_id}.json"

    agent = Agent(
        model=get_model("claude-primary"),
        tools=[read_pdf_text, s3_write],
        system_prompt=_SYSTEM_PROMPT,
    )
    prompt = (
        f"Extract fields from the PDF chunk at: {chunk_s3_path}\n\n"
        f"Fields to extract:\n{custom_fields}\n\n"
        f"Write the extraction result to: {extract_s3_path}\n\n"
        f"First call read_pdf_text to get the text, then extract the fields and write to S3."
    )
    agent(prompt)

    # Return only the minimal reference — the full data is in S3
    return json.dumps({"chunkId": chunk_id, "tempJsonS3Path": extract_s3_path})
