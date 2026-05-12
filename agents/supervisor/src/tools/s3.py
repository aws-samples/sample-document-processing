import boto3
from strands import tool

_s3 = boto3.client("s3")


@tool
def s3_read(s3_path: str) -> str:
    """Read a file from S3 and return its content as a string.

    Args:
        s3_path: Full S3 URI, e.g. s3://bucket/key/file.json
    """
    bucket, key = s3_path.replace("s3://", "").split("/", 1)
    obj = _s3.get_object(Bucket=bucket, Key=key)
    return obj["Body"].read().decode("utf-8")


@tool
def s3_write(s3_path: str, content: str) -> str:
    """Write content to S3 as a JSON file. Returns the S3 path written.

    Args:
        s3_path: Full S3 URI, e.g. s3://bucket/output/doc-id/result.json
        content: The JSON string content to write
    """
    bucket, key = s3_path.replace("s3://", "").split("/", 1)
    _s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=content.encode("utf-8"),
        ContentType="application/json",
    )
    return s3_path
