from strands import Agent, tool

from src.llm import get_model
from src.tools.s3 import s3_read, s3_write

_SYSTEM_PROMPT = """\
You are the Mapping Agent in a document processing pipeline.
You read extraction results from S3 (one file per chunk) and the output schema from S3,
then deep-merge all extraction data into a single JSON object conforming to the schema.

## Your Tools
- s3_read: Reads a file from S3 and returns its content as a string.

## Process
1. Read the output schema from S3
2. Read each extraction result file from S3
3. Deep-merge all extractedData objects into one JSON conforming to the schema
4. Write the merged result to S3 at the mapped_output_s3_path
5. Return ONLY the S3 path where the result was written

## Data Structure
Each extraction result has:
- vendor: shared top-level object (company that issued the invoices)
- invoices: array of invoice objects extracted from that chunk
- wireTransfer: shared top-level object (payment details)

## Merge Rules
Chunks are ordered (chunk-0 is earliest).

1. **vendor** (shared): Deep-merge across chunks. Use first non-null value for each sub-field.
2. **wireTransfer** (shared): Deep-merge across chunks. Use first non-null value for each sub-field.
3. **invoices** (array): Concatenate all invoice arrays from all chunks in order.
   - De-duplicate invoices by invoiceNumber — if the same invoiceNumber appears in adjacent chunks
     (page boundary), merge their data (deep-merge fields, concatenate lineItems).
   - Each invoice keeps its own billTo, shipTo, lineItems, totals, notes, etc.
4. **Null/missing**: If vendor or wireTransfer is null in all chunks, set to null in output.

## Output
Write the merged JSON to S3 using s3_write at the mapped_output_s3_path provided.
The JSON written must conform to the output_schema with all required fields present.
After writing, return ONLY the S3 path as a short confirmation string. Do NOT return the full JSON.

## Additional Rules
- Apply lookup_data to enrich values if applicable (e.g. map vendor name to vendor code)
- Respect field types defined in the output_schema (string, number, boolean, integer, array, object)
- Every required field in the output_schema must be present (set to null if truly not found)
- Do NOT flatten nested objects — preserve the nested structure (vendor.name stays inside vendor object)
- Do NOT duplicate data across sections (e.g. billTo data should NOT appear under vendor)
- The final output must have: vendor (object), invoices (array), wireTransfer (object)
- Do NOT put invoice-specific data (invoiceNumber, billTo, lineItems, totals) at the top level
"""


@tool
def mapping_agent(extraction_s3_paths: str, output_schema_s3_path: str, mapped_output_s3_path: str, lookup_data: str) -> str:
    """Merge extraction results from all chunks into a single JSON object matching the output schema.

    Reads extraction results and output schema from S3. Writes merged result to S3.

    Args:
        extraction_s3_paths: JSON array of S3 paths to extraction result files
        output_schema_s3_path: S3 path to the output schema JSON file
        mapped_output_s3_path: S3 path where the merged result should be written
        lookup_data: JSON object of lookup/reference data for enrichment
    """
    agent = Agent(
        model=get_model("claude-primary"),
        tools=[s3_read, s3_write],
        system_prompt=_SYSTEM_PROMPT,
    )
    prompt = (
        f"Deep-merge extraction results from multiple PDF chunks into a single JSON object.\n\n"
        f"1. Read the output schema from: {output_schema_s3_path}\n"
        f"2. Read each extraction result from these S3 paths: {extraction_s3_paths}\n"
        f"3. Deep-merge all extractedData: vendor and wireTransfer merged across chunks, "
        f"invoices arrays concatenated, de-duplicate by invoiceNumber at chunk boundaries.\n"
        f"4. Write the merged JSON to: {mapped_output_s3_path}\n\n"
        f"Lookup Data:\n{lookup_data}\n\n"
        f"Read all S3 files, merge, write result to S3, then return ONLY the S3 path."
    )
    result = agent(prompt)
    return str(result)
