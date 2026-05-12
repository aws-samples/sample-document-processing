"""DynamoDB helpers for the Documents table."""

import boto3
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key
from shared.constants import DOCUMENTS_TABLE, CONNECTIONS_TABLE, REGION

_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_documents_table = _dynamodb.Table(DOCUMENTS_TABLE)
_connections_table = _dynamodb.Table(CONNECTIONS_TABLE)


# ── Documents ────────────────────────────────────────────────────────────────

def create_document(item: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    item.setdefault("createdAt", now)
    item.setdefault("updatedAt", now)
    item.setdefault("status", "Queued")
    _documents_table.put_item(Item=item)
    return item


def get_document(doc_id: str) -> dict | None:
    resp = _documents_table.get_item(Key={"id": doc_id})
    return resp.get("Item")


def list_documents() -> list[dict]:
    resp = _documents_table.scan()
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = _documents_table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    items.sort(key=lambda d: d.get("createdAt", ""), reverse=True)
    return items


def update_document(doc_id: str, updates: dict) -> dict:
    updates["updatedAt"] = datetime.now(timezone.utc).isoformat()
    expr_parts = []
    attr_names = {}
    attr_values = {}
    for i, (k, v) in enumerate(updates.items()):
        placeholder = f"#k{i}"
        value_ph = f":v{i}"
        expr_parts.append(f"{placeholder} = {value_ph}")
        attr_names[placeholder] = k
        attr_values[value_ph] = v
    resp = _documents_table.update_item(
        Key={"id": doc_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


# ── WebSocket Connections ────────────────────────────────────────────────────

def put_connection(connection_id: str, customer_name: str = "") -> None:
    now = datetime.now(timezone.utc).isoformat()
    item: dict = {
        "connectionId": connection_id,
        "connectedAt": now,
    }
    if customer_name:
        item["customerName"] = customer_name
    # TTL: 24 hours from now
    import time
    item["ttl"] = int(time.time()) + 86400
    _connections_table.put_item(Item=item)


def delete_connection(connection_id: str) -> None:
    _connections_table.delete_item(Key={"connectionId": connection_id})


def list_connections() -> list[dict]:
    resp = _connections_table.scan()
    return resp.get("Items", [])
