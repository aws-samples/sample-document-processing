from strands import Agent, tool

from src.llm import get_model
from src.tools.s3 import s3_read, s3_write
from src.tools.schema import validate_json_schema

_SYSTEM_PROMPT = """\
You are the Validation Agent in a document processing pipeline.
You read a mapped JSON result and output schema from S3, validate the JSON, fix any issues,
and write the corrected result to S3.

## Your Tools
- s3_read: Reads a file from S3 and returns its content as a string.
- s3_write: Writes content to S3.
- validate_json_schema: Programmatically validates JSON against a JSON Schema.

## Process
1. Read the mapped JSON from S3 (the mapped_json_s3_path)
2. Read the output schema from S3 (the output_schema_s3_path)
3. Call validate_json_schema with the JSON and schema
4. Review the validation errors
5. Fix each violation:
   - Type mismatches: coerce values (e.g. "123" -> 123 for number fields)
   - Missing required fields: set to null
   - Extra fields not in schema: keep them but note as an issue
6. Write the corrected JSON to the validated_output_s3_path using s3_write
7. Return ONLY the S3 path as confirmation — do NOT return the full JSON

Rules:
- Write only the corrected data JSON to S3 (NOT the wrapper with issues/isValid)
- Return a short confirmation string with the S3 path
"""


@tool
def validation_agent(mapped_json_s3_path: str, output_schema_s3_path: str, validated_output_s3_path: str) -> str:
    """Validate a JSON object against the output schema. Fixes violations and writes result to S3.

    Reads the mapped JSON and schema from S3, writes corrected result to S3.

    Args:
        mapped_json_s3_path: S3 path to the mapped JSON file to validate
        output_schema_s3_path: S3 path to the JSON Schema file
        validated_output_s3_path: S3 path where the validated/corrected JSON should be written
    """
    agent = Agent(
        model=get_model("claude-fast"),
        tools=[s3_read, s3_write, validate_json_schema],
        system_prompt=_SYSTEM_PROMPT,
    )
    prompt = (
        f"Validate the mapped JSON against the output schema.\n\n"
        f"1. Read the mapped JSON from: {mapped_json_s3_path}\n"
        f"2. Read the output schema from: {output_schema_s3_path}\n"
        f"3. Call validate_json_schema with both, then fix any issues found.\n"
        f"4. Write the corrected JSON to: {validated_output_s3_path}\n\n"
        f"Write only the corrected data to S3, then return the S3 path."
    )
    agent(prompt)

    # Return only the S3 path — the full data is in S3
    return validated_output_s3_path
