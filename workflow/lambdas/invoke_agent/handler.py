"""Step 3: Invoke AgentCore Supervisor Agent.

Calls the Supervisor agent on Bedrock AgentCore with the document data,
schema, lookups, and processing parameters. Returns the agent's output.

Uses a Lambda wrapper (not direct SDK integration) because the agent can
take several minutes and the Step Functions SDK integration uses default
HTTP timeouts that are too short.
"""

import json
import os
import boto3
from botocore.config import Config
from shared.constants import REGION

try:
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
except ImportError:
    pass

AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
if not AGENT_RUNTIME_ARN:
    raise EnvironmentError(
        "AGENT_RUNTIME_ARN environment variable is required. "
        "Set it to the ARN of your Bedrock AgentCore supervisor runtime."
    )

# Extended read timeout for long-running agent invocations (up to 15 min Lambda max)
agentcore = boto3.client(
    "bedrock-agentcore",
    region_name=REGION,
    config=Config(read_timeout=900, connect_timeout=30, retries={"max_attempts": 0}),
)


def handler(event, context):
    """
    Input from Step Functions (assembled from parallel retrieval outputs):
    {
        "documentId": "doc-abc12345",
        "pdfS3Path": "s3://bucket/uploads/doc-abc12345/file.pdf",
        "customerName": "Pinnacle Financial Group",
        "userName": "sirija",
        "customFields": [...],
        "outputSchema": {...},
        "schemaType": "invoice",
        "lookups": {...},
        "ssmParams": {"chunk_size": "5", "pages_per_chunk": "10"}
    }
    """
    document_id = event["documentId"]

    # Build agent payload matching SupervisorInput schema
    agent_payload = {
        "documentId": document_id,
        "pdfS3Path": event["pdfS3Path"],
        "customerName": event.get("customerName", ""),
        "userName": event.get("userName", "sirija"),
        "customFields": event.get("customFields", []),
        "outputSchema": event.get("outputSchema", {}),
        "schemaType": event.get("schemaType", "invoice"),
        "lookups": event.get("lookups", {}),
        "ssmParams": event.get("ssmParams", {"chunk_size": "5", "pages_per_chunk": "10"}),
    }

    payload_bytes = json.dumps(agent_payload).encode("utf-8")

    # Invoke AgentCore supervisor agent
    try:
        response = agentcore.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            payload=payload_bytes,
            contentType="application/json",
        )

        # Parse response — boto3 returns the body under the 'response' key
        response_body = response["response"].read().decode("utf-8")
        agent_result = json.loads(response_body)
    except agentcore.exceptions.RuntimeClientError as e:
        error_msg = str(e)
        print(f"AgentCore runtime error for {document_id}: {error_msg}")
        if "timed out" in error_msg.lower():
            raise TimeoutError(
                f"Agent timed out processing document {document_id}. "
                f"The document may be too large for a single invocation."
            ) from e
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"Unexpected error invoking agent for {document_id}: {error_msg}")
        if "incomplete chunked read" in error_msg.lower() or "peer closed" in error_msg.lower():
            raise TimeoutError(
                f"Agent connection lost processing document {document_id}: {error_msg}"
            ) from e
        raise

    # Return only the clean fields — no input echo
    return {
        "documentId": agent_result.get("documentId", document_id),
        "customerName": agent_result.get("customerName", event.get("customerName", "")),
        "pdfS3Path": agent_result.get("pdfS3Path", event.get("pdfS3Path", "")),
        "outputS3Path": agent_result.get("outputS3Path", ""),
        "errors": agent_result.get("errors", []),
    }
