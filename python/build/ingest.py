"""Ingest EDID files from linuxhw/EDID repository into DuckLake.

Optimized for speed using:
- os.scandir() for fast file discovery
- multiprocessing for parallel parsing
- PyArrow for writing Parquet files with custom names
- DuckLake for versioned, remote-accessible storage
- Incremental updates with diff detection
"""

import hashlib
import json
import os
import shutil
import subprocess
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from tqdm import tqdm

from .parser import parse_edid_file, validate_edid_checksum

# Schema for EDID parquet files
EDID_SCHEMA = pa.schema([
    ("linuxhw_id", pa.binary()),
    ("linuxhw_id_hex", pa.string()),
    ("raw_edid", pa.binary()),
    ("vendor", pa.string()),
    ("model", pa.string()),
    ("product_name", pa.string()),
    ("serial_number", pa.string()),
    ("manufacture_year", pa.int32()),
    ("manufacture_week", pa.int32()),
    ("path_vendor", pa.string()),
    ("path_model", pa.string()),
    ("width_px", pa.int32()),
    ("height_px", pa.int32()),
    ("width_mm", pa.int32()),
    ("height_mm", pa.int32()),
    ("display_type", pa.string()),
    ("screen_size_inches", pa.float32()),
    ("source_path", pa.string()),
    ("checksum_valid", pa.bool_()),
])


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


def _result_to_dict(result: tuple, repo_str: str) -> dict:
    """Convert parsed result tuple to dict with relative path."""
    source_path = result[17]
    if source_path.startswith(repo_str):
        source_path = source_path[len(repo_str) + 1:]

    return {
        "linuxhw_id": result[0],
        "linuxhw_id_hex": result[1],
        "raw_edid": result[2],
        "vendor": result[3],
        "model": result[4],
        "product_name": result[5],
        "serial_number": result[6],
        "manufacture_year": result[7],
        "manufacture_week": result[8],
        "path_vendor": result[9],
        "path_model": result[10],
        "width_px": result[11],
        "height_px": result[12],
        "width_mm": result[13],
        "height_mm": result[14],
        "display_type": result[15],
        "screen_size_inches": result[16],
        "source_path": source_path,
        "checksum_valid": result[18],
    }


def _write_parquet_files(
    records: list[dict],
    output_dir: Path,
    commit: str,
    batch_size: int,
    is_incremental: bool = False,
    show_progress: bool = True,
) -> list[Path]:
    """Write records to parquet files with custom naming.

    Full ingest: edid_{commit}_{batch:03d}.parquet
    Incremental: edid_{commit}_incr_{timestamp}_{batch:03d}.parquet
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    written_files = []

    # Generate timestamp for incremental files
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S") if is_incremental else None

    for batch_num, i in enumerate(range(0, len(records), batch_size)):
        batch = records[i:i + batch_size]

        # Build filename
        if is_incremental:
            filename = f"edid_{commit}_incr_{timestamp}_{batch_num:03d}.parquet"
        else:
            filename = f"edid_{commit}_{batch_num:03d}.parquet"

        filepath = output_dir / filename

        # Build PyArrow table
        table = pa.table({
            "linuxhw_id": [r["linuxhw_id"] for r in batch],
            "linuxhw_id_hex": [r["linuxhw_id_hex"] for r in batch],
            "raw_edid": [r["raw_edid"] for r in batch],
            "vendor": [r["vendor"] for r in batch],
            "model": [r["model"] for r in batch],
            "product_name": [r["product_name"] for r in batch],
            "serial_number": [r["serial_number"] for r in batch],
            "manufacture_year": [r["manufacture_year"] for r in batch],
            "manufacture_week": [r["manufacture_week"] for r in batch],
            "path_vendor": [r["path_vendor"] for r in batch],
            "path_model": [r["path_model"] for r in batch],
            "width_px": [r["width_px"] for r in batch],
            "height_px": [r["height_px"] for r in batch],
            "width_mm": [r["width_mm"] for r in batch],
            "height_mm": [r["height_mm"] for r in batch],
            "display_type": [r["display_type"] for r in batch],
            "screen_size_inches": [r["screen_size_inches"] for r in batch],
            "source_path": [r["source_path"] for r in batch],
            "checksum_valid": [r["checksum_valid"] for r in batch],
        }, schema=EDID_SCHEMA)

        # Write with zstd compression
        pq.write_table(table, filepath, compression="zstd")
        written_files.append(filepath)

        if show_progress:
            total = min(i + batch_size, len(records))
            print(f"  Wrote batch {batch_num + 1}: {total}/{len(records)}")

    return written_files


def _compute_diff(
    conn: duckdb.DuckDBPyConnection,
    new_records: list[dict],
    show_progress: bool = True,
) -> dict:
    """Compute diff between existing DuckLake data and new parsed results.

    Returns dict with: added (list), modified (list), deleted_ids (list)
    Uses MD5 hash of raw_edid for change detection.
    """
    if show_progress:
        print("Computing diff with existing data...")

    # Build lookup of new records by linuxhw_id
    new_by_id = {r["linuxhw_id"]: r for r in new_records}
    new_ids = set(new_by_id.keys())

    # Get existing records with their content hashes
    existing = conn.execute("""
        SELECT linuxhw_id, md5(raw_edid) as content_hash
        FROM edid.edids
    """).fetchall()

    existing_by_id = {}
    for row in existing:
        linuxhw_id = bytes(row[0]) if isinstance(row[0], memoryview) else row[0]
        existing_by_id[linuxhw_id] = row[1]
    existing_ids = set(existing_by_id.keys())

    # Find added, modified, deleted
    added_ids = new_ids - existing_ids
    deleted_ids = existing_ids - new_ids
    common_ids = new_ids & existing_ids

    # Check for modifications in common records
    modified_ids = set()
    for linuxhw_id in common_ids:
        new_hash = hashlib.md5(new_by_id[linuxhw_id]["raw_edid"]).hexdigest()
        if new_hash != existing_by_id[linuxhw_id]:
            modified_ids.add(linuxhw_id)

    added = [new_by_id[id] for id in added_ids]
    modified = [new_by_id[id] for id in modified_ids]

    if show_progress:
        print(f"  Added: {len(added)}, Modified: {len(modified)}, Deleted: {len(deleted_ids)}")

    return {
        "added": added,
        "modified": modified,
        "deleted_ids": list(deleted_ids),
    }


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
    edids_dir = data_path / "edids"

    # Get upstream version info
    upstream_info = get_upstream_info(upstream_path)
    commit = upstream_info["commit"]

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
        "upstream_commit": commit,
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

    # Convert to dicts with relative paths
    records = [_result_to_dict(r, repo_str) for r in unique_results]

    # Connect to DuckDB and load DuckLake extension
    conn = duckdb.connect()
    conn.execute("INSTALL ducklake")
    conn.execute("LOAD ducklake")

    # Check if this is a fresh ingest or incremental update
    is_fresh = not ducklake_path.exists()

    if is_fresh:
        # Fresh ingest - clean slate
        if show_progress:
            print("Fresh ingest - creating new DuckLake...")

        # Remove any existing data
        wal_path = ducklake_path.with_suffix(".ducklake.wal")
        if wal_path.exists():
            wal_path.unlink()
        for table_dir in ["main", "edids"]:
            table_path = data_path / table_dir
            if table_path.exists():
                shutil.rmtree(table_path)

        # Create directories
        edids_dir.mkdir(parents=True, exist_ok=True)
        (data_path / "main" / "edids").mkdir(parents=True, exist_ok=True)

        # Write parquet files with custom names
        if show_progress:
            print(f"Writing parquet files to {edids_dir}/...")
        written_files = _write_parquet_files(
            records, edids_dir, commit, batch_size,
            is_incremental=False, show_progress=show_progress
        )

        # Create DuckLake and register files
        conn.execute(f"""
            ATTACH '{ducklake_path}' AS edid (
                TYPE ducklake,
                DATA_PATH '{data_path}'
            )
        """)

        # Create empty table with schema
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

        # Register external parquet files with DuckLake in single transaction
        if show_progress:
            print("Registering files with DuckLake...")
        conn.execute("BEGIN TRANSACTION")
        for filepath in written_files:
            conn.execute(f"CALL ducklake_add_data_files('edid', 'edids', '{filepath}')")
        conn.execute("COMMIT")

    else:
        # Incremental update
        if show_progress:
            print("Incremental update - computing diff...")

        # Attach existing DuckLake
        conn.execute(f"""
            ATTACH '{ducklake_path}' AS edid (
                TYPE ducklake,
                DATA_PATH '{data_path}'
            )
        """)

        # Compute diff
        diff = _compute_diff(conn, records, show_progress)

        if not diff["added"] and not diff["modified"] and not diff["deleted_ids"]:
            if show_progress:
                print("No changes detected - database is up to date")
            stats["added"] = 0
            stats["modified"] = 0
            stats["deleted"] = 0
        else:
            # Handle changes in single transaction
            conn.execute("BEGIN TRANSACTION")

            # Delete modified and deleted records
            ids_to_delete = diff["deleted_ids"] + [r["linuxhw_id"] for r in diff["modified"]]
            if ids_to_delete:
                if show_progress:
                    print(f"Deleting {len(ids_to_delete)} records...")
                # Delete in batches
                for i in range(0, len(ids_to_delete), 1000):
                    batch = ids_to_delete[i:i + 1000]
                    placeholders = ", ".join([f"x'{id.hex()}'" for id in batch])
                    conn.execute(f"DELETE FROM edid.edids WHERE linuxhw_id IN ({placeholders})")

            # Write and register new/modified records
            records_to_add = diff["added"] + diff["modified"]
            if records_to_add:
                if show_progress:
                    print(f"Adding {len(records_to_add)} records...")
                written_files = _write_parquet_files(
                    records_to_add, edids_dir, commit, batch_size,
                    is_incremental=True, show_progress=show_progress
                )
                for filepath in written_files:
                    conn.execute(f"CALL ducklake_add_data_files('edid', 'edids', '{filepath}')")

            conn.execute("COMMIT")

            stats["added"] = len(diff["added"])
            stats["modified"] = len(diff["modified"])
            stats["deleted"] = len(diff["deleted_ids"])

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
