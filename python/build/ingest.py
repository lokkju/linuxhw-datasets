"""Ingest EDID files from linuxhw/EDID repository into DuckDB."""

from pathlib import Path

import duckdb
from tqdm import tqdm

from .parser import parse_edid_file, validate_edid_checksum


def create_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the database schema."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS edids (
            md5_hash BLOB PRIMARY KEY,
            md5_hex VARCHAR NOT NULL,
            raw_edid BLOB NOT NULL,

            -- Parsed metadata
            vendor VARCHAR,
            model VARCHAR,
            product_name VARCHAR,
            serial_number VARCHAR,
            manufacture_year INTEGER,
            manufacture_week INTEGER,

            -- Display properties
            width_px INTEGER,
            height_px INTEGER,
            width_mm INTEGER,
            height_mm INTEGER,
            display_type VARCHAR,

            -- Source info
            source_path VARCHAR NOT NULL,

            -- Validation
            checksum_valid BOOLEAN,

            -- Timestamps
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create indexes for common queries
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vendor ON edids(vendor)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_resolution ON edids(width_px, height_px)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_year ON edids(manufacture_year)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_display_type ON edids(display_type)")


def find_edid_files(repo_path: Path) -> list[Path]:
    """Find all EDID files in the repository."""
    edid_files = []

    # EDID files are in Digital/ and Analog/ directories
    for type_dir in ["Digital", "Analog"]:
        type_path = repo_path / type_dir
        if not type_path.exists():
            continue

        # Walk through vendor/model/hash structure
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


def ingest_edid_repo(
    repo_path: Path,
    db_path: Path,
    *,
    batch_size: int = 1000,
    show_progress: bool = True,
) -> dict:
    """Ingest EDID repository into DuckDB database."""
    repo_path = Path(repo_path)
    db_path = Path(db_path)

    # Ensure output directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Find all EDID files
    edid_files = find_edid_files(repo_path)

    stats = {
        "total_files": len(edid_files),
        "parsed": 0,
        "failed": 0,
        "invalid_checksum": 0,
        "duplicates": 0,
    }

    # Connect to DuckDB
    conn = duckdb.connect(str(db_path))
    create_schema(conn)

    # Prepare insert statement
    insert_sql = """
        INSERT OR IGNORE INTO edids (
            md5_hash, md5_hex, raw_edid,
            vendor, model, product_name, serial_number,
            manufacture_year, manufacture_week,
            width_px, height_px, width_mm, height_mm,
            display_type, source_path, checksum_valid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    # Process files in batches
    batch = []
    iterator = tqdm(edid_files, desc="Ingesting EDIDs") if show_progress else edid_files

    for file_path in iterator:
        parsed = parse_edid_file(file_path)
        if parsed is None:
            stats["failed"] += 1
            continue

        checksum_valid = validate_edid_checksum(parsed.raw_edid)
        if not checksum_valid:
            stats["invalid_checksum"] += 1

        # Make path relative to repo
        try:
            relative_path = str(file_path.relative_to(repo_path))
        except ValueError:
            relative_path = str(file_path)

        batch.append((
            parsed.md5_hash,
            parsed.md5_hex,
            parsed.raw_edid,
            parsed.vendor,
            parsed.model,
            parsed.product_name,
            parsed.serial_number,
            parsed.manufacture_year,
            parsed.manufacture_week,
            parsed.width_px,
            parsed.height_px,
            parsed.width_mm,
            parsed.height_mm,
            parsed.display_type,
            relative_path,
            checksum_valid,
        ))

        stats["parsed"] += 1

        # Insert batch
        if len(batch) >= batch_size:
            conn.executemany(insert_sql, batch)
            batch = []

    # Insert remaining
    if batch:
        conn.executemany(insert_sql, batch)

    # Get duplicate count
    result = conn.execute("SELECT COUNT(*) FROM edids").fetchone()
    unique_count = result[0] if result else 0
    stats["duplicates"] = stats["parsed"] - unique_count
    stats["unique"] = unique_count

    conn.close()
    return stats
