"""Generate compact binary files from DuckDB database."""

import json
import re
import struct
from pathlib import Path

import duckdb
from pyroaring import BitMap
from tqdm import tqdm

# Bucket file format constants
BUCKET_MAGIC = b"EDIB"
BUCKET_VERSION = 1

# Packed index file format constants
INDEX_MAGIC = b"EIDX"
INDEX_VERSION = 1


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

    # Clean up old indexes directory if it exists
    old_indexes_dir = metadata_dir / "indexes"
    if old_indexes_dir.exists():
        import shutil
        shutil.rmtree(old_indexes_dir)

    conn = duckdb.connect(str(db_path), read_only=True)

    stats = {
        "buckets_written": 0,
        "total_entries": 0,
        "total_bytes": 0,
        "bucket_counts": [],  # Entry count per bucket (0-255)
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

    # Write bucket files and track counts
    bucket_counts = [0] * 256
    iterator = range(256)
    if show_progress:
        iterator = tqdm(iterator, desc="Writing buckets")

    for prefix in iterator:
        bucket_entries = buckets[prefix]
        bucket_counts[prefix] = len(bucket_entries)
        if not bucket_entries:
            continue

        bucket_path = buckets_dir / f"{prefix:02x}.bin"
        write_bucket_file(bucket_path, prefix, bucket_entries)
        stats["buckets_written"] += 1
        stats["total_bytes"] += bucket_path.stat().st_size

    stats["bucket_counts"] = bucket_counts

    # Build and write packed Roaring bitmap indexes
    vendor_stats = build_packed_index(
        conn, "path_vendor", metadata_dir / "vendors.idx", md5_to_index
    )
    product_stats = build_product_index(
        conn, metadata_dir / "products.idx", md5_to_index
    )
    code_stats = build_code_index(
        conn, metadata_dir / "codes.idx", md5_to_index
    )
    size_stats = build_packed_size_index(
        conn, metadata_dir / "sizes.idx", md5_to_index
    )
    path_stats = build_path_index(
        conn, metadata_dir / "paths.idx", md5_to_index
    )

    # Write manifest
    manifest = {
        "version": 6,
        "total_entries": stats["total_entries"],
        "buckets": stats["buckets_written"],
        "bucket_counts": stats["bucket_counts"],
        "indexes": {
            "vendors": vendor_stats,
            "products": product_stats,
            "codes": code_stats,
            "sizes": size_stats,
            "paths": path_stats,
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


def write_packed_index(output_path: Path, entries: list[tuple[str, BitMap]]) -> dict:
    """Write a packed index file containing all bitmaps.

    Format:
        Header (16 bytes):
            magic: 4 bytes "EIDX"
            version: 2 bytes
            entry_count: 4 bytes
            reserved: 6 bytes

        Entry table (12 bytes per entry):
            string_offset: 4 bytes (offset into strings section)
            string_length: 2 bytes
            bitmap_offset: 4 bytes (offset into bitmaps section)
            bitmap_length: 2 bytes (actually stored as length, max 65535)

        Strings section:
            UTF-8 encoded strings, packed

        Bitmaps section:
            Serialized Roaring bitmaps, packed
    """
    entry_count = len(entries)
    header_size = 16
    entry_table_size = entry_count * 12

    # Build strings and bitmaps sections
    strings_data = bytearray()
    bitmaps_data = bytearray()
    entry_table = []

    for key, bitmap in entries:
        key_bytes = key.encode("utf-8")
        bitmap_bytes = bitmap.serialize()

        entry_table.append({
            "string_offset": len(strings_data),
            "string_length": len(key_bytes),
            "bitmap_offset": len(bitmaps_data),
            "bitmap_length": len(bitmap_bytes),
        })

        strings_data.extend(key_bytes)
        bitmaps_data.extend(bitmap_bytes)

    # Calculate section offsets
    strings_offset = header_size + entry_table_size
    bitmaps_offset = strings_offset + len(strings_data)

    # Build file
    data = bytearray()

    # Header
    data.extend(INDEX_MAGIC)
    data.extend(struct.pack("<H", INDEX_VERSION))
    data.extend(struct.pack("<I", entry_count))
    data.extend(b"\x00" * 6)  # Reserved

    # Entry table
    for entry in entry_table:
        data.extend(struct.pack(
            "<IHIH",
            strings_offset + entry["string_offset"],
            entry["string_length"],
            bitmaps_offset + entry["bitmap_offset"],
            entry["bitmap_length"],
        ))

    # Strings section
    data.extend(strings_data)

    # Bitmaps section
    data.extend(bitmaps_data)

    output_path.write_bytes(bytes(data))

    return {
        "count": entry_count,
        "total_bytes": len(data),
        "strings_bytes": len(strings_data),
        "bitmaps_bytes": len(bitmaps_data),
    }


def build_packed_index(
    conn: duckdb.DuckDBPyConnection,
    column: str,
    output_path: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build a packed Roaring bitmap index for a column."""
    result = conn.execute(f"""
        SELECT {column}, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE {column} IS NOT NULL
        GROUP BY {column}
        ORDER BY {column}
    """).fetchall()

    entries = []
    for value, md5_list in result:
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])
        entries.append((str(value), bitmap))

    return write_packed_index(output_path, entries)


def strip_vendor_prefix(product_name: str, vendor: str | None) -> str:
    """Strip vendor prefix from product name if it matches.

    Examples:
        "DELL U2412M" with vendor "Dell" -> "U2412M"
        "LG ULTRAWIDE" with vendor "Goldstar" -> "ULTRAWIDE" (LG is Goldstar's brand)
        "BenQ GW2480" with vendor "BenQ" -> "GW2480"
    """
    if not product_name or not vendor:
        return product_name

    # Common brand mappings (vendor directory name -> EDID brand prefixes)
    brand_prefixes = {
        "goldstar": ["lg"],
        "dell": ["dell"],
        "benq": ["benq"],
        "ancor communications": ["asus"],
        "acer": ["acer"],
        "samsung": ["samsung", "sam"],
        "hewlett packard": ["hp"],
        "lenovo": ["lenovo", "len"],
        "philips": ["philips"],
        "sony": ["sony"],
        "panasonic": ["panasonic"],
        "toshiba": ["toshiba"],
        "lg electronics": ["lg"],
        "asus": ["asus"],
        "viewsonic": ["viewsonic"],
        "aoc": ["aoc"],
    }

    vendor_lower = vendor.lower()
    prefixes_to_try = [vendor_lower]

    # Add known brand prefixes for this vendor
    if vendor_lower in brand_prefixes:
        prefixes_to_try.extend(brand_prefixes[vendor_lower])

    product_lower = product_name.lower()
    for prefix in prefixes_to_try:
        # Check for "PREFIX " or "PREFIX-" at start
        if product_lower.startswith(prefix + " "):
            return product_name[len(prefix) + 1:].strip()
        if product_lower.startswith(prefix + "-"):
            return product_name[len(prefix) + 1:].strip()

    return product_name


def build_product_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build a packed product index using product_name with vendor prefix stripped."""
    result = conn.execute("""
        SELECT product_name, path_vendor, md5_hex
        FROM edids
        WHERE product_name IS NOT NULL
        ORDER BY product_name
    """).fetchall()

    # Group by normalized model name
    model_to_md5s: dict[str, list[str]] = {}
    for product_name, vendor, md5_hex in result:
        # Strip vendor prefix
        model = strip_vendor_prefix(product_name, vendor)
        if model:
            if model not in model_to_md5s:
                model_to_md5s[model] = []
            model_to_md5s[model].append(md5_hex)

    # Build bitmaps
    entries = []
    for model in sorted(model_to_md5s.keys()):
        bitmap = BitMap()
        for md5_hex in model_to_md5s[model]:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])
        entries.append((model, bitmap))

    return write_packed_index(output_path, entries)


def build_code_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build a packed index for vendor+model PNP ID codes (e.g., DEL01101, SAM0A7C)."""
    result = conn.execute("""
        SELECT vendor || model as pnp_code, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE vendor IS NOT NULL AND model IS NOT NULL
        GROUP BY pnp_code
        ORDER BY pnp_code
    """).fetchall()

    entries = []
    for code, md5_list in result:
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])
        entries.append((code, bitmap))

    return write_packed_index(output_path, entries)


def build_packed_size_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build a packed screen size index."""
    result = conn.execute("""
        SELECT screen_size_inches, LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE screen_size_inches IS NOT NULL
        GROUP BY screen_size_inches
        ORDER BY screen_size_inches
    """).fetchall()

    entries = []
    for size, md5_list in result:
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])
        entries.append((f"{size:.1f}", bitmap))

    return write_packed_index(output_path, entries)


def build_path_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    md5_to_index: dict[str, int],
) -> dict:
    """Build a packed index for source paths (directory portion only).

    Paths like "Digital/Dell/DEL4080/abc123" become "Digital/Dell/DEL4080".
    This allows browsing by the linuxhw/EDID repository structure.
    """
    # Extract directory path (remove the hash filename at the end)
    result = conn.execute("""
        SELECT
            regexp_replace(source_path, '/[^/]+$', '') as dir_path,
            LIST(md5_hex ORDER BY md5_hex)
        FROM edids
        WHERE source_path IS NOT NULL
        GROUP BY dir_path
        ORDER BY dir_path
    """).fetchall()

    entries = []
    for path, md5_list in result:
        bitmap = BitMap()
        for md5_hex in md5_list:
            if md5_hex in md5_to_index:
                bitmap.add(md5_to_index[md5_hex])
        entries.append((path, bitmap))

    return write_packed_index(output_path, entries)
