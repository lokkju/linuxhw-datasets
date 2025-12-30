"""Validate linuxhw ID computation against all EDID files."""

import hashlib
import re
from pathlib import Path

from tqdm import tqdm


def compute_linuxhw_id(edid_hex: str) -> str:
    """Compute linuxhw filename from EDID hex string.

    The ID is MD5 of the FULL hex string (not binary),
    truncated to 12 characters, uppercase.
    """
    # MD5 of full hex string, first 12 chars, uppercase
    return hashlib.md5(edid_hex.lower().encode()).hexdigest()[:12].upper()


def extract_hex_from_file(file_path: Path) -> str | None:
    """Extract hex string from EDID file.

    Files can have two formats:
    1. Old format: 'EDID (hex):' followed by 32-char hex lines (no spaces)
    2. New format: 'edid-decode (hex):' followed by 47-char hex lines (with spaces)

    Some files have BOTH formats. The ID is computed from the FIRST hex block found.
    Blank lines may appear between EDID blocks (base + extensions).
    Stop at '---' separator or non-hex text content.

    Some files contain DUPLICATE EDID data (same blocks repeated).
    The ID is computed from the first occurrence only.
    """
    try:
        content = file_path.read_text()
        lines = content.split('\n')

        hex_lines = []
        in_hex_block = False

        for line in lines:
            line = line.rstrip()

            # Check if this is a hex line (32 chars no space OR 47 chars with spaces)
            is_hex_no_space = bool(re.match(r'^[a-f0-9]{32}$', line))
            is_hex_spaced = bool(re.match(r'^[a-f0-9]{2}( [a-f0-9]{2}){15}$', line))

            if is_hex_no_space or is_hex_spaced:
                in_hex_block = True
                hex_lines.append(line.replace(' ', ''))

                # Check for duplicate EDID - look for header at 128-byte boundaries
                combined = ''.join(hex_lines)
                # Check at 128 bytes (256 hex), 256 bytes (512 hex), etc.
                # Support up to 4-block EDIDs (1024 hex chars)
                for boundary in [256, 512, 768, 1024]:
                    if len(combined) > boundary and combined[boundary:boundary+16] == '00ffffffffffff00':
                        # Truncate to first occurrence
                        return combined[:boundary]
            elif in_hex_block:
                # Allow blank lines between EDID blocks
                if line == '':
                    continue
                # Stop at separator or text content
                if line.startswith('-') or (line and not line[0].isspace()):
                    break

        if not hex_lines:
            return None

        return ''.join(hex_lines)
    except Exception:
        return None


def find_edid_files(repo_path: Path) -> list[Path]:
    """Find all EDID files in the repository."""
    edid_files = []

    for type_dir in ["Digital", "Analog"]:
        type_path = repo_path / type_dir
        if not type_path.exists():
            continue

        for vendor_dir in type_path.iterdir():
            if not vendor_dir.is_dir():
                continue
            for model_dir in vendor_dir.iterdir():
                if not model_dir.is_dir():
                    continue
                for edid_file in model_dir.iterdir():
                    if edid_file.is_file() and not edid_file.name.startswith("."):
                        edid_files.append(edid_file)

    return edid_files


def validate_all(repo_path: Path, show_progress: bool = True) -> dict:
    """Validate all EDID files."""
    repo_path = Path(repo_path)
    edid_files = find_edid_files(repo_path)

    stats = {
        "total": 0,
        "match": 0,
        "mismatch": 0,
        "parse_error": 0,
        "errors": [],
    }

    iterator = tqdm(edid_files, desc="Validating") if show_progress else edid_files

    for edid_file in iterator:
        stats["total"] += 1
        expected_id = edid_file.name

        hex_str = extract_hex_from_file(edid_file)
        if hex_str is None:
            stats["parse_error"] += 1
            stats["errors"].append({
                "file": str(edid_file),
                "error": "Could not parse hex from file",
            })
            continue

        computed_id = compute_linuxhw_id(hex_str)

        if computed_id == expected_id:
            stats["match"] += 1
        else:
            stats["mismatch"] += 1
            if len(stats["errors"]) < 20:  # Limit error logging
                stats["errors"].append({
                    "file": str(edid_file),
                    "expected": expected_id,
                    "computed": computed_id,
                    "hex_len": len(hex_str),
                })

    return stats


def main():
    import sys

    if len(sys.argv) > 1:
        repo_path = Path(sys.argv[1])
    else:
        # Default to upstream/EDID relative to project root
        repo_path = Path(__file__).parent.parent.parent / "upstream" / "EDID"

    if not repo_path.exists():
        print(f"Error: Repository path not found: {repo_path}")
        sys.exit(1)

    print(f"Validating EDID files in: {repo_path}")
    stats = validate_all(repo_path)

    print(f"\nValidation Results:")
    print(f"  Total files:   {stats['total']:,}")
    print(f"  Matches:       {stats['match']:,} ({100*stats['match']/stats['total']:.2f}%)")
    print(f"  Mismatches:    {stats['mismatch']:,} ({100*stats['mismatch']/stats['total']:.2f}%)")
    print(f"  Parse errors:  {stats['parse_error']:,}")

    if stats["errors"]:
        print(f"\nFirst {len(stats['errors'])} errors:")
        for err in stats["errors"]:
            if "error" in err:
                print(f"  {err['file']}: {err['error']}")
            else:
                print(f"  {err['file']}")
                print(f"    Expected: {err['expected']}, Computed: {err['computed']}, Hex len: {err['hex_len']}")

    # Exit with error if mismatches
    sys.exit(0 if stats["mismatch"] == 0 else 1)


if __name__ == "__main__":
    main()
