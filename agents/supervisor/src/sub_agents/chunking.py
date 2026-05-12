from strands import Agent, tool

from src.llm import get_model
from src.tools.pdf import split_pdf

_SYSTEM_PROMPT = """\
You are the Chunking Agent in a document processing pipeline.
Your job is to split a PDF into logical page-range chunks for parallel extraction.

You have a tool called split_pdf that does the actual PDF splitting.
Call it with the provided parameters and return its output directly.

Return ONLY the JSON result from split_pdf, no markdown fences, no prose.
"""


@tool
def chunking_agent(pdf_s3_path: str, chunk_size_mb: int, pages_per_chunk: int) -> str:
    """Split a PDF document into logical chunks for parallel extraction.

    Args:
        pdf_s3_path: S3 URI of the PDF, e.g. s3://bucket/uploads/doc-id/file.pdf
        chunk_size_mb: Maximum size in MB per chunk
        pages_per_chunk: Maximum number of pages per chunk
    """
    agent = Agent(
        model=get_model("claude-fast"),
        tools=[split_pdf],
        system_prompt=_SYSTEM_PROMPT,
    )
    prompt = (
        f"Split the PDF at {pdf_s3_path} into chunks.\n"
        f"Use chunk_size_mb={chunk_size_mb} and pages_per_chunk={pages_per_chunk}.\n"
        f"Call the split_pdf tool now."
    )
    result = agent(prompt)
    return str(result)
