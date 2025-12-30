"""Ingest EDID files from linuxhw/EDID repository into DuckDB.

Optimized for speed using:
- os.scandir() for fast file discovery
- multiprocessing for parallel parsing
- PyArrow for bulk DuckDB inserts
"""

import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import duckdb
import pyarrow as pa
from tqdm import tqdm

from .parser import parse_edid_file, validate_edid_checksum


def create_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the database schema."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS edids (
            linuxhw_id BLOB PRIMARY KEY,
            linuxhw_id_hex VARCHAR NOT NULL,
            raw_edid BLOB NOT NULL,

            -- Parsed metadata (from EDID content)
            vendor VARCHAR,
            model VARCHAR,
            product_name VARCHAR,
            serial_number VARCHAR,
            manufacture_year INTEGER,
            manufacture_week INTEGER,

            -- Path-derived metadata (from linuxhw/EDID directory structure)
            path_vendor VARCHAR,
            path_model VARCHAR,

            -- Display properties
            width_px INTEGER,
            height_px INTEGER,
            width_mm INTEGER,
            height_mm INTEGER,
            display_type VARCHAR,
            screen_size_inches REAL,

            -- Source info
            source_path VARCHAR NOT NULL,

            -- Validation
            checksum_valid BOOLEAN,

            -- Timestamps
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create indexes for common queries
    conn.execute("CREATE INDEX IF NOT EXISTS idx_path_vendor ON edids(path_vendor)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_path_model ON edids(path_model)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_screen_size ON edids(screen_size_inches)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_year ON edids(manufacture_year)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_display_type ON edids(display_type)")


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

        # Use os.scandir for faster directory traversal
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


# Top-level function for multiprocessing (can't be nested)
def _parse_file(file_path: str) -> tuple | None:
    """Parse a single EDID file and return tuple of values.

    Returns None on failure, or tuple of (parsed_data, checksum_valid, relative_path).
    """
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
        file_path,  # Will extract relative path later
        checksum_valid,
    )


def ingest_edid_repo(
    repo_path: Path,
    db_path: Path,
    *,
    workers: int | None = None,
    show_progress: bool = True,
) -> dict:
    """Ingest EDID repository into DuckDB database.

    Uses parallel parsing and bulk PyArrow inserts for maximum speed.
    """
    repo_path = Path(repo_path)
    db_path = Path(db_path)
    repo_str = str(repo_path)

    # Ensure output directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Find all EDID files (fast scan)
    if show_progress:
        print("Scanning for EDID files...")
    edid_files = find_edid_files_fast(repo_path)

    stats = {
        "total_files": len(edid_files),
        "parsed": 0,
        "failed": 0,
        "invalid_checksum": 0,
        "duplicates": 0,
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
                if not result[-1]:  # checksum_valid is last element
                    stats["invalid_checksum"] += 1

    if show_progress:
        print(f"Parsed {len(results)} files, loading into DuckDB...")

    # Deduplicate by linuxhw_id (keep first occurrence)
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

    # Build PyArrow table for bulk insert
    # Convert file paths to relative paths
    def make_relative(path: str) -> str:
        if path.startswith(repo_str):
            return path[len(repo_str) + 1:]  # +1 for trailing slash
        return path

    arrow_table = pa.table({
        "linuxhw_id": [r[0] for r in unique_results],
        "linuxhw_id_hex": [r[1] for r in unique_results],
        "raw_edid": [r[2] for r in unique_results],
        "vendor": [r[3] for r in unique_results],
        "model": [r[4] for r in unique_results],
        "product_name": [r[5] for r in unique_results],
        "serial_number": [r[6] for r in unique_results],
        "manufacture_year": [r[7] for r in unique_results],
        "manufacture_week": [r[8] for r in unique_results],
        "path_vendor": [r[9] for r in unique_results],
        "path_model": [r[10] for r in unique_results],
        "width_px": [r[11] for r in unique_results],
        "height_px": [r[12] for r in unique_results],
        "width_mm": [r[13] for r in unique_results],
        "height_mm": [r[14] for r in unique_results],
        "display_type": [r[15] for r in unique_results],
        "screen_size_inches": [r[16] for r in unique_results],
        "source_path": [make_relative(r[17]) for r in unique_results],
        "checksum_valid": [r[18] for r in unique_results],
    })

    # Delete existing database if present
    if db_path.exists():
        db_path.unlink()

    # Create database and insert data
    conn = duckdb.connect(str(db_path), config={
        "threads": os.cpu_count(),
    })

    # Create table from Arrow (fastest method)
    conn.execute("""
        CREATE TABLE edids AS
        SELECT
            linuxhw_id,
            linuxhw_id_hex,
            raw_edid,
            vendor,
            model,
            product_name,
            serial_number,
            manufacture_year,
            manufacture_week,
            path_vendor,
            path_model,
            width_px,
            height_px,
            width_mm,
            height_mm,
            display_type,
            screen_size_inches,
            source_path,
            checksum_valid,
            CURRENT_TIMESTAMP as created_at
        FROM arrow_table
    """)

    # Add primary key constraint and indexes
    conn.execute("ALTER TABLE edids ADD PRIMARY KEY (linuxhw_id)")
    conn.execute("CREATE INDEX idx_path_vendor ON edids(path_vendor)")
    conn.execute("CREATE INDEX idx_path_model ON edids(path_model)")
    conn.execute("CREATE INDEX idx_screen_size ON edids(screen_size_inches)")
    conn.execute("CREATE INDEX idx_year ON edids(manufacture_year)")
    conn.execute("CREATE INDEX idx_display_type ON edids(display_type)")

    # Get final count
    result = conn.execute("SELECT COUNT(*) FROM edids").fetchone()
    stats["unique"] = result[0] if result else 0

    conn.close()

    if show_progress:
        print(f"Loaded {stats['unique']} unique entries into DuckDB")

    return stats


# Keep old function for backwards compatibility
def find_edid_files(repo_path: Path) -> list[Path]:
    """Find all EDID files in the repository (legacy function).

    Use find_edid_files_fast() for better performance.
    """
    return [Path(p) for p in find_edid_files_fast(repo_path)]
