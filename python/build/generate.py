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
    indexes_dir = metadata_dir / "indexes"
    buckets_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir.mkdir(parents=True, exist_ok=True)
    indexes_dir.mkdir(parents=True, exist_ok=True)

    conn = duckdb.connect(str(db_path), read_only=True)

    stats = {
        "buckets_written": 0,
        "total_entries": 0,
        "total_bytes": 0,
    }

    # Get all entries ordered by MD5 hash
    entries = conn.execute("""
        SELECT md5_hash, raw_edid, path_vendor, path_model, product_name,
               manufacture_year, width_px, height_px, width_mm, height_mm,
               display_type, screen_size_inches
        FROM edids
        ORDER BY md5_hash
    """).fetchall()

    stats["total_entries"] = len(entries)

    # Build entry index (md5_hex -> row index) for bitmap lookups
    md5_to_index = {}
    for i, entry in enumerate(entries):
        md5_hex = entry[0].hex()
        md5_to_index[md5_hex] = i

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

    # Build and write Roaring bitmap indexes
    vendor_stats = build_roaring_index(conn, "path_vendor", indexes_dir / "vendors", md5_to_index)
    model_stats = build_roaring_index(conn, "path_model", indexes_dir / "models", md5_to_index)
    size_stats = build_screen_size_index(conn, indexes_dir / "sizes", md5_to_index)

    # Write manifest
    manifest = {
        "version": 2,
        "total_entries": stats["total_entries"],
        "buckets": stats["buckets_written"],
        "indexes": {
            "vendors": vendor_stats,
            "models": model_stats,
            "sizes": size_stats,
        },
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
        (_md5, _raw, path_vendor, path_model, product_name, year,
         w_px, h_px, w_mm, h_mm, dtype, screen_size) = entry
        metadata = encode_metadata(path_vendor, path_model, year, w_px, h_px, w_mm, h_mm, dtype)
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


def build_roaring_index(
    conn: duckdb.DuckDBPyConnection,
    column: str,
    output_dir: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build Roaring bitmap index for a column.

    Creates one .roaring file per unique value containing the bitmap
    of entry indices.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    result = conn.execute(f"""
        SELECT {column}, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE {column} IS NOT NULL
        GROUP BY {column}
        ORDER BY {column}
    """).fetchall()

    stats = {"count": 0, "total_bytes": 0}
    index_manifest = {}

    for value, md5_list in result:
        # Build bitmap of entry indices
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])

        # Serialize and write
        serialized = bitmap.serialize()
        # Sanitize filename
        safe_name = sanitize_filename(str(value))
        file_path = output_dir / f"{safe_name}.roaring"
        file_path.write_bytes(serialized)

        index_manifest[str(value)] = {
            "file": safe_name + ".roaring",
            "count": len(bitmap),
        }
        stats["count"] += 1
        stats["total_bytes"] += len(serialized)

    # Write manifest for this index
    manifest_path = output_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(index_manifest, indent=2))

    return stats


def build_screen_size_index(
    conn: duckdb.DuckDBPyConnection,
    output_dir: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build Roaring bitmap index for screen sizes (in inches)."""
    output_dir.mkdir(parents=True, exist_ok=True)

    result = conn.execute("""
        SELECT screen_size_inches, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE screen_size_inches IS NOT NULL
        GROUP BY screen_size_inches
        ORDER BY screen_size_inches
    """).fetchall()

    stats = {"count": 0, "total_bytes": 0}
    index_manifest = {}

    for size, md5_list in result:
        # Build bitmap of entry indices
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])

        # Serialize and write
        serialized = bitmap.serialize()
        # Use size as filename (e.g., "27.0.roaring")
        size_str = f"{size:.1f}"
        file_path = output_dir / f"{size_str}.roaring"
        file_path.write_bytes(serialized)

        index_manifest[size_str] = {
            "file": size_str + ".roaring",
            "count": len(bitmap),
        }
        stats["count"] += 1
        stats["total_bytes"] += len(serialized)

    # Write manifest for this index
    manifest_path = output_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(index_manifest, indent=2))

    return stats


def sanitize_filename(s: str) -> str:
    """Sanitize a string for use as a filename."""
    import re
    # Replace problematic characters with underscore
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', s)
    # Limit length
    return s[:200]
