import json
import logging
import os
import re
from pathlib import Path

import boto3
from dotenv import load_dotenv
from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Load .env from the supervisor project root for local development.
# On AgentCore, environment variables are injected by the runtime.
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

from src.llm import current_customer, current_user, get_model

from src.models import SupervisorInput, SupervisorOutput
from src.sub_agents.chunking import chunking_agent
from src.sub_agents.extraction import extraction_agent
from src.sub_agents.mapping import mapping_agent
from src.sub_agents.validation import validation_agent
from src.tools.s3 import s3_read, s3_write

log = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are the Document Processing Supervisor. You orchestrate a multi-agent pipeline to
extract structured data from PDF documents and produce validated JSON output.

## Your Tools

- chunking_agent: Splits a PDF into page-range chunks
- extraction_agent: Extracts field values from one chunk (call once per chunk, ALL calls in parallel)
- mapping_agent: Merges all extraction results into the output schema
- validation_agent: Validates and fixes the mapped JSON against the schema
- s3_write: Writes the final validated JSON to S3
- s3_read: Reads a file from S3

## Orchestration Protocol

Follow these steps in strict order:

STEP 1 - CHUNKING
Call chunking_agent with the pdfS3Path and the SSM parameters (chunk_size_mb, pages_per_chunk).
Parse the returned JSON to get the chunks array.

STEP 2 - EXTRACTION (PARALLEL)
For each chunk from Step 1, call extraction_agent with the chunk's s3Path and the field mapping.
Pass the full Custom Fields array (from the prompt below) as the custom_fields argument — this
contains the field mapping that tells the extraction agent exactly which fields to extract,
including dot-notation paths for nested fields (e.g. vendor.name, billTo.address) and array
field definitions with sub-items.
CRITICAL: Issue ALL extraction_agent calls in a SINGLE response to enable parallel execution.
Do NOT call them one at a time in separate turns.

Each extraction_agent returns a small JSON: {"chunkId": "chunk-N", "tempJsonS3Path": "s3://..."}
The actual extraction data is written to S3 by the extraction agent — you do NOT receive it.

STEP 3 - MAPPING
Collect the tempJsonS3Path from each extraction_agent result.
Build a JSON array of these S3 paths, ordered by chunkId (chunk-0 first, then chunk-1, etc.).

Derive paths:
  Schema S3 path: s3://BUCKET/config/schemas/SCHEMA_TYPE.json
  Mapped output S3 path: s3://BUCKET/output/DOC_ID/mapped.json
  (use the bucket from pdfS3Path and the schemaType from the prompt; extract DOC_ID from pdfS3Path)

Call mapping_agent with:
  - extraction_s3_paths: JSON array of S3 paths
  - output_schema_s3_path: the schema S3 path
  - mapped_output_s3_path: where to write the merged result
  - lookup_data: the Lookup Data from the prompt
The mapping agent reads all data from S3 and writes the result to S3.
Do NOT pass extraction data or schema content inline.

STEP 4 - VALIDATION
Derive the final output path: s3://BUCKET/output/DOC_ID/result.json
Call validation_agent with:
  - mapped_json_s3_path: s3://BUCKET/output/DOC_ID/mapped.json (from Step 3)
  - output_schema_s3_path: the same schema S3 path from Step 3
  - validated_output_s3_path: s3://BUCKET/output/DOC_ID/result.json
The validation agent reads from S3, validates, fixes, and writes the final result.json to S3.
You do NOT need to write the output yourself — the validation agent does it.

STEP 5 - SKIP (validation agent already wrote result.json)

STEP 6 - RETURN
Return ONLY this JSON (no prose, no markdown):
{"outputS3Path": "s3://BUCKET/output/DOC_ID/result.json"}

## Error Handling
If any step fails or returns an error, stop immediately and report the error.
Do not attempt partial results or skip steps.
"""

app = BedrockAgentCoreApp()

_s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
_ACCOUNT_ID = os.environ.get("AWS_ACCOUNT_ID", "")
if not _ACCOUNT_ID:
    # Resolve account ID dynamically via STS if not explicitly set
    try:
        _ACCOUNT_ID = boto3.client("sts").get_caller_identity()["Account"]
    except Exception:
        _ACCOUNT_ID = ""
_CONFIG_BUCKET = os.environ.get("CONFIG_BUCKET", f"document-processing-{_ACCOUNT_ID}" if _ACCOUNT_ID else "")


def _load_schema_from_s3(schema_type: str) -> dict:
    """Load an output schema from s3://<bucket>/config/schemas/<schema_type>.json."""
    key = f"config/schemas/{schema_type}.json"
    log.info("Loading schema from s3://%s/%s", _CONFIG_BUCKET, key)
    resp = _s3.get_object(Bucket=_CONFIG_BUCKET, Key=key)
    return json.loads(resp["Body"].read().decode("utf-8"))


def _load_lookups_from_s3(lookup_names: list[str]) -> dict:
    """Load and merge lookup files from s3://<bucket>/config/lookups/<name>.json."""
    merged = {}
    for name in lookup_names:
        key = f"config/lookups/{name}.json"
        log.info("Loading lookup from s3://%s/%s", _CONFIG_BUCKET, key)
        resp = _s3.get_object(Bucket=_CONFIG_BUCKET, Key=key)
        data = json.loads(resp["Body"].read().decode("utf-8"))
        merged[name] = data
    return merged


def _build_prompt(inputs: SupervisorInput) -> str:
    # Derive bucket from pdfS3Path: s3://BUCKET/uploads/...
    bucket = inputs.pdfS3Path.replace("s3://", "").split("/", 1)[0]
    schema_s3_path = f"s3://{bucket}/config/schemas/{inputs.schemaType}.json"

    return (
        f"Process this document:\n\n"
        f"PDF S3 Path: {inputs.pdfS3Path}\n"
        f"Customer Name: {inputs.customerName}\n"
        f"User Name: {inputs.userName}\n"
        f"Schema Type: {inputs.schemaType}\n"
        f"Output Schema S3 Path: {schema_s3_path}\n\n"
        f"Custom Fields to Extract:\n"
        f"{json.dumps(inputs.customFields, indent=2)}\n\n"
        f"Lookup Data:\n"
        f"{json.dumps(inputs.lookups, indent=2)}\n\n"
        f"SSM Parameters:\n"
        f"- chunk_size_mb: {inputs.ssmParams.chunk_size}\n"
        f"- pages_per_chunk: {inputs.ssmParams.pages_per_chunk}\n\n"
        f"Follow the orchestration protocol in your system prompt."
    )


@app.entrypoint
def handler(payload: dict) -> dict:
    log.warning("Raw payload keys: %s, type: %s", list(payload.keys()), type(payload).__name__)

    # agentcore invoke / console wraps payloads as {"prompt": "<json_string>"}
    if "prompt" in payload and "pdfS3Path" not in payload:
        prompt_val = payload["prompt"]
        if isinstance(prompt_val, dict):
            payload = prompt_val
        elif isinstance(prompt_val, str) and prompt_val.strip():
            try:
                parsed = json.loads(prompt_val, strict=False)
                if isinstance(parsed, dict):
                    payload = parsed
            except json.JSONDecodeError:
                pass

    try:
        inputs = SupervisorInput(**payload)
    except Exception as e:
        log.error("Invalid payload: %s", e)
        raise ValueError(f"Invalid payload: {e}") from e

    # Load outputSchema from S3 if not provided inline
    if not inputs.outputSchema:
        inputs.outputSchema = _load_schema_from_s3(inputs.schemaType)

    # Load lookups from S3 if not provided inline but lookupNames specified
    if not inputs.lookups and inputs.lookupNames:
        inputs.lookups = _load_lookups_from_s3(inputs.lookupNames)

    # Set per-request context so get_model() uses the right customer key + user header
    current_customer.set(inputs.customerName)
    current_user.set(inputs.userName)

    # Create supervisor agent per-request (picks up customer key + user header via contextvars)
    supervisor = Agent(
        model=get_model("claude-primary"),
        tools=[chunking_agent, extraction_agent, mapping_agent, validation_agent, s3_read, s3_write],
        system_prompt=_SYSTEM_PROMPT,
    )

    prompt = _build_prompt(inputs)
    errors: list[str] = []

    try:
        result = supervisor(prompt)
    except Exception as e:
        log.error("Supervisor agent failed: %s", e)
        return SupervisorOutput(
            documentId=inputs.documentId,
            customerName=inputs.customerName,
            pdfS3Path=inputs.pdfS3Path,
            outputS3Path="",
            errors=[str(e)],
        ).model_dump()

    # Extract the outputS3Path JSON from the agent result.
    # The supervisor may return prose around the JSON, so we search for it.
    output_s3_path = ""

    texts_to_search = []
    result_str = str(result)
    texts_to_search.append(result_str)
    try:
        for block in result.message.get("content", []):
            if isinstance(block, dict) and "text" in block:
                texts_to_search.append(block["text"])
    except Exception:  # noqa: B110 — best-effort extraction; structure varies by model response  # nosec B110
        pass

    for text in texts_to_search:
        try:
            parsed = json.loads(text.strip())
            if isinstance(parsed, dict) and "outputS3Path" in parsed:
                output_s3_path = parsed["outputS3Path"]
                break
        except (json.JSONDecodeError, ValueError):
            pass
        match = re.search(r'\{[^{}]*"outputS3Path"\s*:\s*"[^"]+"\s*\}', text)
        if match:
            try:
                output_s3_path = json.loads(match.group())["outputS3Path"]
                break
            except (json.JSONDecodeError, KeyError):
                continue

    if not output_s3_path:
        log.error("Could not extract outputS3Path from supervisor output: %s", result_str[:500])
        errors.append("Could not extract outputS3Path from agent output")

    output = SupervisorOutput(
        documentId=inputs.documentId,
        customerName=inputs.customerName,
        pdfS3Path=inputs.pdfS3Path,
        outputS3Path=output_s3_path,
        errors=errors,
    )

    log.info("Supervisor completed. documentId=%s customer=%s outputS3Path=%s errors=%s",
             output.documentId, output.customerName, output.outputS3Path, output.errors)
    return output.model_dump()


if __name__ == "__main__":
    app.run()
