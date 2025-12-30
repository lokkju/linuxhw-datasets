"""Ingest EDID files from linuxhw/EDID repository into DuckLake.

Optimized for speed using:
- os.scandir() for fast file discovery
- multiprocessing for parallel parsing
- PyArrow for bulk inserts
- DuckLake for versioned, remote-accessible storage
"""

import json
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
from tqdm import tqdm

from .parser import parse_edid_file, validate_edid_checksum


def find_edid_files_fast(repo_path: Path) -> list[str]:
    """Find all EDID files using fast os.scandir() traversal.

    Returns list of string paths for pickle compatibility with multiprocessing.
    """
    edid_files = []
    repo_str = str(repo_path)

    for type_dir in ["Digital", "Analog"]:
        type_path = os.path.join(repo_str, type_dir)
        if not os.path.isdir(type_path):
            continue

        with os.scandir(type_path) as vendor_entries:
            for vendor_entry in vendor_entries:
                if not vendor_entry.is_dir():
                    continue

                with os.scandir(vendor_entry.path) as model_entries:
                    for model_entry in model_entries:
                        if not model_entry.is_dir():
                            continue

                        with os.scandir(model_entry.path) as file_entries:
                            for file_entry in file_entries:
                                if file_entry.is_file() and not file_entry.name.startswith("."):
                                    edid_files.append(file_entry.path)

    return edid_files


def _parse_file(file_path: str) -> tuple | None:
    """Parse a single EDID file and return tuple of values."""
    path = Path(file_path)
    parsed = parse_edid_file(path)
    if parsed is None:
        return None

    checksum_valid = validate_edid_checksum(parsed.raw_edid)

    return (
        parsed.linuxhw_id,
        parsed.linuxhw_id_hex,
        parsed.raw_edid,
        parsed.vendor,
        parsed.model,
        parsed.product_name,
        parsed.serial_number,
        parsed.manufacture_year,
        parsed.manufacture_week,
        parsed.path_vendor,
        parsed.path_model,
        parsed.width_px,
        parsed.height_px,
        parsed.width_mm,
        parsed.height_mm,
        parsed.display_type,
        parsed.screen_size_inches,
        file_path,
        checksum_valid,
    )


def get_upstream_info(repo_path: Path) -> dict:
    """Get git commit info from upstream repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            check=True,
        )
        commit = result.stdout.strip()

        result = subprocess.run(
            ["git", "log", "-1", "--format=%ci"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            check=True,
        )
        date_str = result.stdout.strip().split()[0]

        return {"commit": commit, "date": date_str}
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"commit": "unknown", "date": datetime.now().strftime("%Y-%m-%d")}


def update_versions_json(
    versions_path: Path,
    upstream_commit: str,
    upstream_date: str,
    row_count: int,
) -> None:
    """Update versions.json with new version entry."""
    versions = {"current": upstream_commit, "versions": []}

    if versions_path.exists():
        with open(versions_path) as f:
            versions = json.load(f)

    # Add new version entry
    new_version = {
        "upstream": upstream_commit,
        "date": upstream_date,
        "ts": datetime.now(timezone.utc).isoformat(),
        "count": row_count,
    }

    # Update current and prepend new version
    versions["current"] = upstream_commit
    versions["versions"].insert(0, new_version)

    with open(versions_path, "w") as f:
        json.dump(versions, f, indent=2)


def ingest_edid_repo(
    repo_path: Path,
    ducklake_path: Path,
    *,
    upstream_path: Path | None = None,
    workers: int | None = None,
    batch_size: int = 3000,
    show_progress: bool = True,
) -> dict:
    """Ingest EDID repository into DuckLake.

    Args:
        repo_path: Path to linuxhw/EDID repository
        ducklake_path: Path to output .ducklake file
        upstream_path: Path to upstream repo for version info (defaults to repo_path)
        workers: Number of parallel workers (defaults to CPU count)
        batch_size: Rows per Parquet file (controls file size, ~3000 rows ≈ 3MB)
        show_progress: Show progress bars
    """
    repo_path = Path(repo_path)
    ducklake_path = Path(ducklake_path)
    upstream_path = Path(upstream_path) if upstream_path else repo_path
    repo_str = str(repo_path)

    # Ensure output directory exists
    ducklake_path.parent.mkdir(parents=True, exist_ok=True)
    data_path = ducklake_path.parent

    # Get upstream version info
    upstream_info = get_upstream_info(upstream_path)

    # Find all EDID files
    if show_progress:
        print("Scanning for EDID files...")
    edid_files = find_edid_files_fast(repo_path)

    stats = {
        "total_files": len(edid_files),
        "parsed": 0,
        "failed": 0,
        "invalid_checksum": 0,
        "duplicates": 0,
        "upstream_commit": upstream_info["commit"],
        "upstream_date": upstream_info["date"],
    }

    if show_progress:
        print(f"Found {len(edid_files)} files, parsing...")

    # Parse files in parallel
    num_workers = workers or os.cpu_count()
    results = []

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        iterator = executor.map(_parse_file, edid_files, chunksize=500)
        if show_progress:
            iterator = tqdm(iterator, total=len(edid_files), desc="Parsing EDIDs")

        for result in iterator:
            if result is None:
                stats["failed"] += 1
            else:
                results.append(result)
                stats["parsed"] += 1
                if not result[-1]:
                    stats["invalid_checksum"] += 1

    if show_progress:
        print(f"Parsed {len(results)} files, loading into DuckLake...")

    # Deduplicate by linuxhw_id
    seen_ids = set()
    unique_results = []
    for r in results:
        if r[0] not in seen_ids:
            seen_ids.add(r[0])
            unique_results.append(r)
        else:
            stats["duplicates"] += 1

    if show_progress:
        print(f"Deduplicated to {len(unique_results)} unique entries")

    # Convert file paths to relative paths
    def make_relative(path: str) -> str:
        if path.startswith(repo_str):
            return path[len(repo_str) + 1:]
        return path

    # Connect to DuckDB and load DuckLake extension
    conn = duckdb.connect()
    conn.execute("INSTALL ducklake")
    conn.execute("LOAD ducklake")

    # Remove existing DuckLake files if present
    if ducklake_path.exists():
        ducklake_path.unlink()
    wal_path = ducklake_path.with_suffix(".ducklake.wal")
    if wal_path.exists():
        wal_path.unlink()

    # Remove existing data directories
    for table_dir in ["main"]:
        table_path = data_path / table_dir
        if table_path.exists():
            import shutil
            shutil.rmtree(table_path)

    # Create DuckLake with local DATA_PATH
    conn.execute(f"""
        ATTACH '{ducklake_path}' AS edid (
            TYPE ducklake,
            DATA_PATH '{data_path}'
        )
    """)

    # Create tables (single denormalized table for simplicity)
    conn.execute("""
        CREATE TABLE edid.edids (
            linuxhw_id BLOB,
            linuxhw_id_hex VARCHAR,
            raw_edid BLOB,
            vendor VARCHAR,
            model VARCHAR,
            product_name VARCHAR,
            serial_number VARCHAR,
            manufacture_year INTEGER,
            manufacture_week INTEGER,
            path_vendor VARCHAR,
            path_model VARCHAR,
            width_px INTEGER,
            height_px INTEGER,
            width_mm INTEGER,
            height_mm INTEGER,
            display_type VARCHAR,
            screen_size_inches REAL,
            source_path VARCHAR,
            checksum_valid BOOLEAN
        )
    """)

    # Insert in batches to control Parquet file size
    # Use single transaction so all batches = one time-travel snapshot
    conn.execute("BEGIN TRANSACTION")
    total_inserted = 0
    for i in range(0, len(unique_results), batch_size):
        batch = unique_results[i:i + batch_size]

        # Build PyArrow table for this batch
        arrow_table = pa.table({
            "linuxhw_id": [r[0] for r in batch],
            "linuxhw_id_hex": [r[1] for r in batch],
            "raw_edid": [r[2] for r in batch],
            "vendor": [r[3] for r in batch],
            "model": [r[4] for r in batch],
            "product_name": [r[5] for r in batch],
            "serial_number": [r[6] for r in batch],
            "manufacture_year": [r[7] for r in batch],
            "manufacture_week": [r[8] for r in batch],
            "path_vendor": [r[9] for r in batch],
            "path_model": [r[10] for r in batch],
            "width_px": [r[11] for r in batch],
            "height_px": [r[12] for r in batch],
            "width_mm": [r[13] for r in batch],
            "height_mm": [r[14] for r in batch],
            "display_type": [r[15] for r in batch],
            "screen_size_inches": [r[16] for r in batch],
            "source_path": [make_relative(r[17]) for r in batch],
            "checksum_valid": [r[18] for r in batch],
        })

        # Insert batch (creates one Parquet file per batch)
        conn.execute("INSERT INTO edid.edids SELECT * FROM arrow_table")
        total_inserted += len(batch)

        if show_progress:
            print(f"  Inserted batch {i // batch_size + 1}: {total_inserted}/{len(unique_results)}")

    conn.execute("COMMIT")

    # Get final count
    result = conn.execute("SELECT COUNT(*) FROM edid.edids").fetchone()
    stats["unique"] = result[0] if result else 0

    conn.close()

    # Update versions.json
    versions_path = data_path / "versions.json"
    update_versions_json(
        versions_path,
        upstream_info["commit"],
        upstream_info["date"],
        stats["unique"],
    )

    if show_progress:
        print(f"Loaded {stats['unique']} entries into DuckLake")
        print(f"Upstream: {upstream_info['commit']} ({upstream_info['date']})")

    return stats


# Keep old function for backwards compatibility
def find_edid_files(repo_path: Path) -> list[Path]:
    """Find all EDID files in the repository (legacy function)."""
    return [Path(p) for p in find_edid_files_fast(repo_path)]
