"""$connect — Store WebSocket connection ID in DynamoDB."""

from shared.db import put_connection


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    # Customer name can be passed as a query param on connect
    params = event.get("queryStringParameters") or {}
    customer_name = params.get("customerName", "")

    put_connection(connection_id, customer_name)

    return {"statusCode": 200, "body": "Connected"}
