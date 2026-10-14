"""Small JSON-Schema validator for the three frozen workspace contracts.

Only standard-library code is used.  The implementation deliberately supports
the subset present in docs/_work/{schema,result.schema,ops.schema}.json.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "docs" / "_work"


class SchemaError(ValueError):
    """Raised when JSON does not satisfy a workspace schema."""


@lru_cache(maxsize=None)
def load_schema(filename: str) -> dict[str, Any]:
    with (SCHEMA_DIR / filename).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _resolve_ref(root: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise SchemaError(f"unsupported external schema reference: {ref}")
    node: Any = root
    for raw in ref[2:].split("/"):
        token = raw.replace("~1", "/").replace("~0", "~")
        node = node[token]
    return node


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "boolean":
        return type(value) is bool
    if expected == "integer":
        return type(value) is int
    if expected == "number":
        return type(value) in (int, float)
    if expected == "string":
        return isinstance(value, str)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    raise SchemaError(f"unsupported schema type: {expected}")


def _validate(
    value: Any,
    schema: dict[str, Any],
    root: dict[str, Any],
    path: str,
) -> None:
    if "$ref" in schema:
        _validate(value, _resolve_ref(root, schema["$ref"]), root, path)
        return

    if "anyOf" in schema:
        errors: list[str] = []
        for branch in schema["anyOf"]:
            try:
                _validate(value, branch, root, path)
                return
            except SchemaError as exc:
                errors.append(str(exc))
        raise SchemaError(f"{path}: no anyOf branch matched ({'; '.join(errors)})")

    if "oneOf" in schema:
        matches = 0
        errors: list[str] = []
        for branch in schema["oneOf"]:
            try:
                _validate(value, branch, root, path)
                matches += 1
            except SchemaError as exc:
                errors.append(str(exc))
        if matches != 1:
            raise SchemaError(
                f"{path}: expected exactly one oneOf branch, got {matches}"
                + (f" ({'; '.join(errors)})" if matches == 0 else "")
            )
        return

    expected = schema.get("type")
    if expected is not None:
        choices = [expected] if isinstance(expected, str) else expected
        if not any(_type_matches(value, choice) for choice in choices):
            raise SchemaError(f"{path}: expected {choices}, got {type(value).__name__}")

    if "const" in schema and value != schema["const"]:
        raise SchemaError(f"{path}: expected constant {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(f"{path}: {value!r} is not an allowed value")

    if type(value) is int:
        if "minimum" in schema and value < schema["minimum"]:
            raise SchemaError(f"{path}: {value} is below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            raise SchemaError(f"{path}: {value} is above maximum")

    if isinstance(value, str) and "pattern" in schema:
        if re.search(schema["pattern"], value) is None:
            raise SchemaError(f"{path}: string does not match {schema['pattern']!r}")

    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            _validate(item, schema["items"], root, f"{path}[{index}]")

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        missing = [key for key in schema.get("required", []) if key not in value]
        if missing:
            raise SchemaError(f"{path}: missing required keys {missing}")
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(value) - set(properties))
            if unknown:
                raise SchemaError(f"{path}: unknown keys {unknown}")
        for key, item in value.items():
            child_schema = properties.get(key)
            if child_schema is not None:
                _validate(item, child_schema, root, f"{path}.{key}")


def validate(value: Any, schema: dict[str, Any]) -> None:
    _validate(value, schema, schema, "$")


def validate_case(case: Any) -> None:
    validate(case, load_schema("schema.json"))


def validate_ops(ops: Any) -> None:
    validate(ops, load_schema("ops.schema.json"))


def validate_result(result: Any) -> None:
    validate(result, load_schema("result.schema.json"))

