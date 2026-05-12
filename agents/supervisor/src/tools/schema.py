import json

from strands import tool


@tool
def validate_json_schema(json_string: str, schema_string: str) -> str:
    """Programmatically validate a JSON object against a JSON Schema.

    Args:
        json_string: The JSON object to validate, as a string
        schema_string: The JSON Schema to validate against, as a string

    Returns a JSON result with isValid boolean and a list of error messages.
    """
    import jsonschema

    try:
        data = json.loads(json_string)
    except json.JSONDecodeError as e:
        return json.dumps({"isValid": False, "errors": [f"Invalid JSON: {e}"]})

    try:
        schema = json.loads(schema_string)
    except json.JSONDecodeError as e:
        return json.dumps({"isValid": False, "errors": [f"Invalid schema: {e}"]})

    validator = jsonschema.Draft7Validator(schema)
    errors = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        path = ".".join(str(p) for p in error.absolute_path) or "(root)"
        errors.append(f"{path}: {error.message}")

    return json.dumps({"isValid": len(errors) == 0, "errors": errors})
