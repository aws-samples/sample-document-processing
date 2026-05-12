import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    # python-dotenv is optional — Lambda injects env vars via CDK.
    load_dotenv = None  # type: ignore[assignment]

# Load .env from the backend/ directory (or project root) for local development.
# In Lambda, environment variables are injected by CDK — dotenv is a no-op.
if load_dotenv is not None:
    _backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(_backend_dir / ".env")
    load_dotenv(_backend_dir.parent / ".env")  # fallback to project root

REGION = os.environ.get("AWS_REGION", "us-east-1")
DOCUMENTS_TABLE = os.environ.get("DOCUMENTS_TABLE", "DocumentProcessing-Documents")
CONNECTIONS_TABLE = os.environ.get("CONNECTIONS_TABLE", "DocumentProcessing-WebSocketConnections")
DOCUMENT_BUCKET = os.environ.get("DOCUMENT_BUCKET", "")
WEBSOCKET_API_ENDPOINT = os.environ.get("WEBSOCKET_API_ENDPOINT", "")
WORKFLOW_STATE_MACHINE_ARN = os.environ.get("WORKFLOW_STATE_MACHINE_ARN", "")
PRESIGNED_URL_EXPIRY = int(os.environ.get("PRESIGNED_URL_EXPIRY", "3600"))
