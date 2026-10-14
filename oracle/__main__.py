"""Command-line interface for ``python -m oracle``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .engine import evaluate_payload


def _load(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top-level JSON must be an object")
    return value


def _serialized(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    ) + "\n"


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(_serialized(value))


def run_command(path: Path) -> int:
    result = evaluate_payload(_load(path))
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stdout.write(_serialized(result))
    return 0


def _batch_group(source: Path, destination: Path) -> int:
    count = 0
    for path in sorted(source.glob("*.json"), key=lambda item: item.name):
        try:
            result = evaluate_payload(_load(path))
        except Exception as exc:
            raise ValueError(f"{path}: {exc}") from exc
        _write(destination / path.name, result)
        count += 1
    return count


def batch_command(cases: Path, vectors: Path, out: Path) -> int:
    if not cases.is_dir():
        raise ValueError(f"cases directory does not exist: {cases}")
    if not vectors.is_dir():
        raise ValueError(f"vectors directory does not exist: {vectors}")
    _batch_group(cases, out / "cases")
    _batch_group(vectors, out / "vectors")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="python -m oracle")
    commands = result.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("input_json", type=Path)
    batch = commands.add_parser("batch")
    batch.add_argument("--cases", type=Path, required=True)
    batch.add_argument("--vectors", type=Path, required=True)
    batch.add_argument("--out", type=Path, required=True)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "run":
        return run_command(args.input_json)
    return batch_command(args.cases, args.vectors, args.out)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, KeyError, IndexError) as exc:
        sys.stderr.write(f"oracle: {exc}\n")
        raise SystemExit(2) from exc

