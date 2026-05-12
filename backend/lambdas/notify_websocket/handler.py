"""Server-push via API Gateway Management API — broadcast status updates to connected clients.

Invoked by Step Functions or other backend services when document status changes.
Expected event format:
{
  "documentId": "doc-xxx",
  "status": "In Review",
  "outputS3Path": "s3://..."  (optional)
}
"""

import json
import boto3
from shared.constants import WEBSOCKET_API_ENDPOINT, REGION
from shared.db import list_connections


def handler(event, context):
    if not WEBSOCKET_API_ENDPOINT:
        print("WEBSOCKET_API_ENDPOINT not configured, skipping notification")
        return {"statusCode": 200}

    apigw = boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=WEBSOCKET_API_ENDPOINT,
        region_name=REGION,
    )

    message = json.dumps({
        "type": "statusUpdate",
        "documentId": event.get("documentId"),
        "status": event.get("status"),
        "outputS3Path": event.get("outputS3Path", ""),
    })

    connections = list_connections()
    stale = []

    for conn in connections:
        cid = conn["connectionId"]
        try:
            apigw.post_to_connection(ConnectionId=cid, Data=message.encode("utf-8"))
        except apigw.exceptions.GoneException:
            stale.append(cid)
        except Exception as e:
            print(f"Failed to send to {cid}: {e}")

    # Clean up stale connections
    if stale:
        from shared.db import delete_connection
        for cid in stale:
            delete_connection(cid)

    return {"statusCode": 200, "body": f"Notified {len(connections) - len(stale)} clients"}
