"""Step 2: Parallel data retrieval — custom fields, lookups, and SSM params.

A single Lambda that handles three retrieval types based on the 'retrievalType'
input parameter. Step Functions Parallel state invokes this Lambda three times
with different parameters.
"""

import json
import os
import boto3
from shared.constants import REGION, DOCUMENTS_TABLE, DOCUMENT_BUCKET

dynamodb = boto3.resource("dynamodb", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)

SSM_PREFIX = os.environ.get("SSM_PREFIX", "/document-processing/")


def handler(event, context):
    """
    Input from Step Functions:
    {
        "retrievalType": "custom_fields" | "lookups" | "ssm_params",
        "documentId": "doc-abc12345",
        "schemaType": "invoice",
        "customerName": "Pinnacle Financial Group"
    }
    """
    retrieval_type = event["retrievalType"]
    document_id = event["documentId"]
    schema_type = event.get("schemaType", "invoice")

    if retrieval_type == "custom_fields":
        return retrieve_custom_fields(document_id, schema_type)
    elif retrieval_type == "lookups":
        return retrieve_lookups(schema_type)
    elif retrieval_type == "ssm_params":
        return retrieve_ssm_params()
    else:
        raise ValueError(f"Unknown retrievalType: {retrieval_type}")


def _load_field_mapping(schema_type):
    """Load field mapping from s3://<bucket>/config/mapping/<schema_type>.json."""
    mapping_key = f"config/mapping/{schema_type}.json"
    try:
        response = s3.get_object(Bucket=DOCUMENT_BUCKET, Key=mapping_key)
        mapping = json.loads(response["Body"].read().decode("utf-8"))
        return mapping.get("fields", [])
    except Exception:
        print(f"Mapping not found at s3://{DOCUMENT_BUCKET}/{mapping_key}, using empty field list")
        return []


def retrieve_custom_fields(document_id, schema_type):
    """Fetch the output schema and field mapping for this document type."""
    schema_key = f"config/schemas/{schema_type}.json"
    try:
        response = s3.get_object(Bucket=DOCUMENT_BUCKET, Key=schema_key)
        schema = json.loads(response["Body"].read().decode("utf-8"))
    except Exception:
        schema = {}
        print(f"Schema not found at s3://{DOCUMENT_BUCKET}/{schema_key}, using empty schema")

    custom_fields = _load_field_mapping(schema_type)

    return {
        "retrievalType": "custom_fields",
        "documentId": document_id,
        "schemaType": schema_type,
        "outputSchema": schema,
        "customFields": custom_fields,
    }


def retrieve_lookups(schema_type):
    """Fetch lookup data (vendor codes, mappings) from S3."""
    lookups = {}
    lookup_prefix = "config/lookups/"

    try:
        response = s3.list_objects_v2(Bucket=DOCUMENT_BUCKET, Prefix=lookup_prefix)
        for obj in response.get("Contents", []):
            key = obj["Key"]
            filename = key.split("/")[-1]
            data = s3.get_object(Bucket=DOCUMENT_BUCKET, Key=key)
            content = data["Body"].read().decode("utf-8")
            try:
                lookups[filename] = json.loads(content)
            except json.JSONDecodeError:
                lookups[filename] = content
    except Exception as e:
        print(f"Error retrieving lookups: {e}")

    return {
        "retrievalType": "lookups",
        "lookups": lookups,
    }


def retrieve_ssm_params():
    """Fetch processing parameters from SSM Parameter Store."""
    param_names = [
        f"{SSM_PREFIX}chunk_size_mb",
        f"{SSM_PREFIX}pages_per_chunk",
        f"{SSM_PREFIX}agent_timeout_seconds",
    ]

    params = {}
    try:
        response = ssm.get_parameters(Names=param_names, WithDecryption=False)
        for param in response["Parameters"]:
            # Extract short name from full path
            short_name = param["Name"].split("/")[-1]
            params[short_name] = param["Value"]
    except Exception as e:
        print(f"Error retrieving SSM params: {e}")

    # Defaults matching SupervisorInput.SsmParams schema
    params.setdefault("chunk_size_mb", "10")
    params.setdefault("pages_per_chunk", "5")
    params.setdefault("agent_timeout_seconds", "900")
    # Map to agent-expected keys
    params["chunk_size"] = params.get("chunk_size_mb", "5")
    params["pages_per_chunk"] = params.get("pages_per_chunk", "10")

    return {
        "retrievalType": "ssm_params",
        "params": params,
    }
