import io
import math

import boto3
from pypdf import PdfReader, PdfWriter
from strands import tool

_s3 = boto3.client("s3")


def _parse_s3_uri(s3_path: str) -> tuple[str, str]:
    """Parse s3://bucket/key into (bucket, key)."""
    path = s3_path.replace("s3://", "")
    bucket, key = path.split("/", 1)
    return bucket, key


@tool
def split_pdf(pdf_s3_path: str, pages_per_chunk: int, chunk_size_mb: float) -> str:
    """Split a PDF from S3 into page-range chunks, upload each chunk back to S3.

    Args:
        pdf_s3_path: S3 URI of the source PDF, e.g. s3://bucket/uploads/doc-id/file.pdf
        pages_per_chunk: Maximum number of pages per chunk
        chunk_size_mb: Maximum size in MB per chunk (soft limit, splits further if exceeded)

    Returns a JSON array of chunk metadata with chunkId, startPage, endPage, s3Path.
    """
    import json

    bucket, key = _parse_s3_uri(pdf_s3_path)

    # Extract document ID from path: uploads/{doc_id}/filename.pdf
    parts = key.split("/")
    doc_id = parts[1] if len(parts) >= 3 else parts[0]

    # Download PDF
    response = _s3.get_object(Bucket=bucket, Key=key)
    pdf_bytes = response["Body"].read()
    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)

    # Calculate chunks — use whichever limit (page count or size) is hit first
    chunk_size_bytes = chunk_size_mb * 1024 * 1024
    chunks = []
    chunk_idx = 0
    page_idx = 0

    while page_idx < total_pages:
        start_page = page_idx + 1  # 1-based
        writer = PdfWriter()
        num_pages = 0

        # Add pages one by one until either limit is reached
        while page_idx + num_pages < total_pages and num_pages < pages_per_chunk:
            writer.add_page(reader.pages[page_idx + num_pages])
            num_pages += 1

            # Check size after adding each page
            buf = io.BytesIO()
            writer.write(buf)
            if buf.tell() > chunk_size_bytes and num_pages > 1:
                # Size limit exceeded — remove last page
                writer = PdfWriter()
                num_pages -= 1
                for p in range(page_idx, page_idx + num_pages):
                    writer.add_page(reader.pages[p])
                break

        end_page = page_idx + num_pages

        # Write final chunk bytes
        chunk_buffer = io.BytesIO()
        writer.write(chunk_buffer)
        chunk_bytes = chunk_buffer.getvalue()

        # Upload chunk to S3
        chunk_key = f"chunks/{doc_id}/chunk-{chunk_idx}.pdf"
        _s3.put_object(
            Bucket=bucket,
            Key=chunk_key,
            Body=chunk_bytes,
            ContentType="application/pdf",
        )

        chunks.append({
            "chunkId": f"chunk-{chunk_idx}",
            "startPage": start_page,
            "endPage": end_page,
            "s3Path": f"s3://{bucket}/{chunk_key}",
        })

        page_idx = end_page
        chunk_idx += 1

    return json.dumps({"chunks": chunks})


@tool
def read_pdf_text(pdf_s3_path: str) -> str:
    """Download a PDF from S3 and extract all text content.

    Args:
        pdf_s3_path: S3 URI of the PDF, e.g. s3://bucket/chunks/doc-id/chunk-0.pdf

    Returns the extracted text from all pages, separated by page markers.
    """
    bucket, key = _parse_s3_uri(pdf_s3_path)

    response = _s3.get_object(Bucket=bucket, Key=key)
    pdf_bytes = response["Body"].read()
    reader = PdfReader(io.BytesIO(pdf_bytes))

    text_parts = []
    for i, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        text_parts.append(f"--- Page {i + 1} ---\n{page_text}")

    return "\n\n".join(text_parts)
