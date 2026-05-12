"""API Gateway response helpers."""

import json
from decimal import Decimal


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def success(body: dict | list, status_code: int = 200) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        },
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def error(message: str, status_code: int = 400) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        },
        "body": json.dumps({"error": message}),
    }
