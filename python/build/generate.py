"""Generate compact binary files from DuckDB database."""

import json
import struct
from pathlib import Path

import duckdb
from pyroaring import BitMap
from tqdm import tqdm

# Bucket file format constants
BUCKET_MAGIC = b"EDIB"
BUCKET_VERSION = 1


def generate_compact_files(
    db_path: Path,
    output_path: Path,
    *,
    show_progress: bool = True,
) -> dict:
    """Generate compact binary files from DuckDB database."""
    db_path = Path(db_path)
    output_path = Path(output_path)

    # Create output directories
    buckets_dir = output_path / "buckets"
    metadata_dir = output_path / "metadata"
    buckets_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir.mkdir(parents=True, exist_ok=True)

    conn = duckdb.connect(str(db_path), read_only=True)

    stats = {
        "buckets_written": 0,
        "total_entries": 0,
        "total_bytes": 0,
    }

    # Get all entries ordered by MD5 hash
    entries = conn.execute("""
        SELECT md5_hash, raw_edid, vendor, model, product_name,
               manufacture_year, width_px, height_px, width_mm, height_mm,
               display_type
        FROM edids
        ORDER BY md5_hash
    """).fetchall()

    stats["total_entries"] = len(entries)

    # Group entries by first byte of MD5 (bucket prefix)
    buckets: dict[int, list] = {i: [] for i in range(256)}
    for entry in entries:
        md5_hash = entry[0]
        prefix = md5_hash[0]
        buckets[prefix].append(entry)

    # Write bucket files
    iterator = range(256)
    if show_progress:
        iterator = tqdm(iterator, desc="Writing buckets")

    for prefix in iterator:
        bucket_entries = buckets[prefix]
        if not bucket_entries:
            continue

        bucket_path = buckets_dir / f"{prefix:02x}.bin"
        write_bucket_file(bucket_path, prefix, bucket_entries)
        stats["buckets_written"] += 1
        stats["total_bytes"] += bucket_path.stat().st_size

    # Build indexes
    vendor_index = build_vendor_index(conn)
    resolution_index = build_resolution_index(conn)
    year_index = build_year_index(conn)

    # Write indexes as JSON for now (TODO: FST format)
    (metadata_dir / "vendors.json").write_text(json.dumps(vendor_index, indent=2))
    (metadata_dir / "resolutions.json").write_text(json.dumps(resolution_index, indent=2))
    (metadata_dir / "years.json").write_text(json.dumps(year_index, indent=2))

    # Write manifest
    manifest = {
        "version": 1,
        "total_entries": stats["total_entries"],
        "buckets": stats["buckets_written"],
        "vendors": len(vendor_index),
        "resolutions": len(resolution_index),
        "years": len(year_index),
    }
    (output_path / "manifest.json").write_text(json.dumps(manifest, indent=2))

    conn.close()
    return stats


def write_bucket_file(path: Path, prefix: int, entries: list) -> None:
    """Write a single bucket file."""
    # Sort entries by remaining 15 bytes of MD5
    entries.sort(key=lambda e: e[0][1:])

    entry_count = len(entries)

    # Calculate offsets
    header_size = 16
    keys_size = entry_count * 15  # 15 bytes per key (excluding prefix)
    metadata_size = entry_count * 16  # 16 bytes per metadata entry
    offsets_size = entry_count * 4  # 4 bytes per offset

    values_offset = header_size + keys_size + metadata_size + offsets_size

    # Build the file content
    data = bytearray()

    # Header (16 bytes)
    data.extend(BUCKET_MAGIC)
    data.extend(struct.pack("<H", BUCKET_VERSION))
    data.extend(struct.pack("<H", entry_count))
    data.extend(struct.pack("<I", values_offset))
    data.extend(b"\x00" * 4)  # Reserved

    # Keys (15 bytes each, remaining bytes of MD5)
    for entry in entries:
        md5_hash = entry[0]
        data.extend(md5_hash[1:])  # Skip first byte (bucket prefix)

    # Metadata (16 bytes each)
    for entry in entries:
        _md5, _raw, vendor, model, product_name, year, w_px, h_px, w_mm, h_mm, dtype = entry
        metadata = encode_metadata(vendor, model, year, w_px, h_px, w_mm, h_mm, dtype)
        data.extend(metadata)

    # Build values section and offsets
    values_section = bytearray()
    offsets = []

    for entry in entries:
        raw_edid = entry[1]
        offset = len(values_section)
        length = len(raw_edid)

        # Pack offset (24 bits) and length (8 bits, divided by 4)
        length_div4 = min(length // 4, 255)
        packed = (offset & 0xFFFFFF) | ((length_div4 & 0xFF) << 24)
        offsets.append(struct.pack("<I", packed))

        values_section.extend(raw_edid)
        # Align to 4 bytes
        padding = (4 - len(raw_edid) % 4) % 4
        values_section.extend(b"\x00" * padding)

    # Write offsets
    for offset_bytes in offsets:
        data.extend(offset_bytes)

    # Write values
    data.extend(values_section)

    path.write_bytes(bytes(data))


def encode_metadata(
    vendor: str | None,
    model: str | None,
    year: int | None,
    w_px: int | None,
    h_px: int | None,
    w_mm: int | None,
    h_mm: int | None,
    dtype: str | None,
) -> bytes:
    """Encode metadata into 16 bytes."""
    # For now, just store numeric fields
    # TODO: Implement proper string table references
    year_val = year if year else 0
    w_px_val = w_px if w_px else 0
    h_px_val = h_px if h_px else 0
    w_mm_val = w_mm if w_mm else 0
    h_mm_val = h_mm if h_mm else 0
    dtype_val = 1 if dtype == "digital" else (0 if dtype == "analog" else 2)

    return struct.pack(
        "<HHHHHHHBB",
        0,  # vendor_id (TODO)
        0,  # model_id (TODO)
        year_val,
        w_px_val,
        h_px_val,
        w_mm_val & 0xFFFF,
        h_mm_val & 0xFFFF,
        dtype_val,
        0,  # flags
    )


def build_vendor_index(conn: duckdb.DuckDBPyConnection) -> dict:
    """Build vendor -> MD5 hex list index."""
    result = conn.execute("""
        SELECT vendor, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE vendor IS NOT NULL
        GROUP BY vendor
        ORDER BY vendor
    """).fetchall()
    return {row[0]: row[1] for row in result}


def build_resolution_index(conn: duckdb.DuckDBPyConnection) -> dict:
    """Build resolution -> MD5 hex list index."""
    result = conn.execute("""
        SELECT width_px || 'x' || height_px as res, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE width_px IS NOT NULL AND height_px IS NOT NULL
        GROUP BY res
        ORDER BY res
    """).fetchall()
    return {row[0]: row[1] for row in result}


def build_year_index(conn: duckdb.DuckDBPyConnection) -> dict:
    """Build year -> MD5 hex list index."""
    result = conn.execute("""
        SELECT CAST(manufacture_year AS VARCHAR) as year, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE manufacture_year IS NOT NULL
        GROUP BY manufacture_year
        ORDER BY manufacture_year
    """).fetchall()
    return {row[0]: row[1] for row in result}
