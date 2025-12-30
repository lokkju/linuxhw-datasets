"""Generate compact binary files from DuckLake database."""

import json
import re
import struct
import subprocess
from datetime import datetime
from pathlib import Path

import duckdb
from pyroaring import BitMap
from tqdm import tqdm


def get_upstream_info(upstream_path: Path) -> dict:
    """Get git revision info from upstream EDID repo."""
    try:
        # Get the current commit hash
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=upstream_path,
            capture_output=True,
            text=True,
            check=True,
        )
        commit = result.stdout.strip()[:12]  # Short hash

        # Get the commit date
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ci"],
            cwd=upstream_path,
            capture_output=True,
            text=True,
            check=True,
        )
        date_str = result.stdout.strip()
        # Parse and reformat: "2024-01-15 10:30:00 +0000" -> "2024-01-15"
        date = date_str.split()[0]

        return {"commit": commit, "date": date}
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"commit": "unknown", "date": "unknown"}

# Bucket file format constants
BUCKET_MAGIC = b"EDIB"
BUCKET_VERSION = 4  # v4: per-entry vendor name for correct GitHub URLs

# Packed index file format constants
INDEX_MAGIC = b"EIDX"
INDEX_VERSION = 1


def generate_compact_files(
    db_path: Path,
    output_path: Path,
    *,
    upstream_path: Path | None = None,
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

    # Connect to DuckLake
    conn = duckdb.connect()
    conn.execute("INSTALL ducklake")
    conn.execute("LOAD ducklake")

    # Attach DuckLake database (read-only)
    conn.execute(f"""
        ATTACH '{db_path}' AS edid (TYPE ducklake)
    """)

    stats = {
        "buckets_written": 0,
        "total_entries": 0,
        "total_bytes": 0,
        "bucket_counts": [],  # Entry count per bucket (0-255)
    }

    # Get all entries ordered by linuxhw ID
    entries = conn.execute("""
        SELECT linuxhw_id, raw_edid, path_vendor, path_model, product_name,
               manufacture_year, width_px, height_px, width_mm, height_mm,
               display_type, screen_size_inches
        FROM edid.edids
        ORDER BY linuxhw_id
    """).fetchall()

    stats["total_entries"] = len(entries)

    # Build entry index (linuxhw_id_hex -> row index) for bitmap lookups
    id_to_index = {}
    for i, entry in enumerate(entries):
        id_hex = entry[0].hex().upper()
        id_to_index[id_hex] = i

    # Group entries by first byte of linuxhw ID (bucket prefix)
    buckets: dict[int, list] = {i: [] for i in range(256)}
    for entry in entries:
        linuxhw_id = entry[0]
        prefix = linuxhw_id[0]
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
        conn, "path_vendor", metadata_dir / "vendors.idx", id_to_index
    )
    product_stats = build_product_index(
        conn, metadata_dir / "products.idx", id_to_index
    )
    code_stats = build_code_index(
        conn, metadata_dir / "codes.idx", id_to_index
    )
    size_stats = build_packed_size_index(
        conn, metadata_dir / "sizes.idx", id_to_index
    )
    path_stats = build_path_index(
        conn, metadata_dir / "paths.idx", id_to_index
    )

    # Get upstream info if path provided
    upstream_info = None
    if upstream_path:
        upstream_info = get_upstream_info(upstream_path)

    # Write manifest
    manifest = {
        "version": 9,  # v9: bucket format v4 with per-entry vendor names
        "bucket_format": 4,  # v4: includes vendor string table per bucket
        "total_entries": stats["total_entries"],
        "buckets": stats["buckets_written"],
        "bucket_counts": stats["bucket_counts"],
        "built_at": datetime.utcnow().strftime("%Y-%m-%d"),
        "indexes": {
            "vendors": vendor_stats,
            "products": product_stats,
            "codes": code_stats,
            "sizes": size_stats,
            "paths": path_stats,
        },
    }
    if upstream_info:
        manifest["upstream"] = upstream_info

    (output_path / "manifest.json").write_text(json.dumps(manifest, indent=2))

    conn.close()
    return stats


def write_bucket_file(path: Path, prefix: int, entries: list) -> None:
    """Write a single bucket file (v4 format: 6-byte ID + vendor name + raw EDID).

    v4 format adds per-entry vendor directory names for correct GitHub URL construction.
    Uses a per-bucket string table with 1-byte indexes to save space.

    Format:
        Header (16 bytes):
            magic: 4 bytes "EDIB"
            version: 2 bytes (4)
            entry_count: 2 bytes
            values_offset: 4 bytes
            vendor_table_offset: 4 bytes

        Keys section: 5 bytes × entry_count
        Vendor indexes: 1 byte × entry_count (index into vendor table)
        Offsets section: 4 bytes × entry_count

        Values section: raw EDID bytes (4-byte aligned)
        Vendor table: count (1 byte) + [length (1 byte) + string bytes]...
    """
    # Sort entries by remaining 5 bytes of ID (first byte is bucket prefix)
    entries.sort(key=lambda e: e[0][1:6])

    entry_count = len(entries)

    # Build vendor string table for this bucket
    vendor_to_index: dict[str, int] = {}
    vendor_list: list[str] = []
    for entry in entries:
        path_vendor = entry[2] or ""  # path_vendor is at index 2
        if path_vendor not in vendor_to_index:
            vendor_to_index[path_vendor] = len(vendor_list)
            vendor_list.append(path_vendor)

    # Calculate section sizes
    header_size = 16
    keys_size = entry_count * 5  # 5 bytes per key
    vendor_indexes_size = entry_count * 1  # 1 byte per vendor index
    offsets_size = entry_count * 4  # 4 bytes per offset

    values_offset = header_size + keys_size + vendor_indexes_size + offsets_size

    # Build the file content
    data = bytearray()

    # Placeholder for header (will fill in vendor_table_offset later)
    header_start = len(data)
    data.extend(BUCKET_MAGIC)
    data.extend(struct.pack("<H", BUCKET_VERSION))
    data.extend(struct.pack("<H", entry_count))
    data.extend(struct.pack("<I", values_offset))
    data.extend(struct.pack("<I", 0))  # vendor_table_offset placeholder

    # Keys (5 bytes each, bytes 1-5 of 6-byte linuxhw ID)
    for entry in entries:
        linuxhw_id = entry[0]
        data.extend(linuxhw_id[1:6])

    # Vendor indexes (1 byte each)
    for entry in entries:
        path_vendor = entry[2] or ""
        vendor_idx = vendor_to_index[path_vendor]
        data.append(vendor_idx)

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

    # Write values section
    data.extend(values_section)

    # Record vendor table offset and write vendor string table
    vendor_table_offset = len(data)
    data.append(len(vendor_list))  # Vendor count (1 byte)
    for vendor in vendor_list:
        vendor_bytes = vendor.encode("utf-8")
        data.append(len(vendor_bytes))  # Length (1 byte)
        data.extend(vendor_bytes)

    # Update header with vendor_table_offset
    struct.pack_into("<I", data, 12, vendor_table_offset)

    path.write_bytes(bytes(data))


def generate_vendors_json(conn: duckdb.DuckDBPyConnection, output_path: Path) -> dict:
    """Generate vendors.json mapping EISA codes to human-readable vendor names.

    This mapping allows computing full GitHub paths from EDID data:
    {type}/{vendor_name}/{model}/{id}
    """
    # Get all unique vendor code -> path_vendor mappings
    result = conn.execute("""
        SELECT DISTINCT vendor as code, path_vendor as name
        FROM edid.edids
        WHERE vendor IS NOT NULL AND path_vendor IS NOT NULL
        ORDER BY vendor
    """).fetchall()

    mapping = {code: name for code, name in result}

    output_path.write_text(json.dumps(mapping, indent=2, sort_keys=True))

    return {
        "count": len(mapping),
        "bytes": output_path.stat().st_size,
    }


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
    id_to_index: dict[str, int],
) -> dict:
    """Build a packed Roaring bitmap index for a column."""
    result = conn.execute(f"""
        SELECT {column}, LIST(linuxhw_id_hex ORDER BY linuxhw_id_hex)
        FROM edid.edids
        WHERE {column} IS NOT NULL
        GROUP BY {column}
        ORDER BY {column}
    """).fetchall()

    entries = []
    for value, id_list in result:
        bitmap = BitMap()
        for id_hex in id_list:
            if id_hex in id_to_index:
                bitmap.add(id_to_index[id_hex])
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
    id_to_index: dict[str, int],
) -> dict:
    """Build a packed product index using product_name with vendor prefix stripped."""
    result = conn.execute("""
        SELECT product_name, path_vendor, linuxhw_id_hex
        FROM edid.edids
        WHERE product_name IS NOT NULL
        ORDER BY product_name
    """).fetchall()

    # Group by normalized model name
    model_to_ids: dict[str, list[str]] = {}
    for product_name, vendor, id_hex in result:
        # Strip vendor prefix
        model = strip_vendor_prefix(product_name, vendor)
        if model:
            if model not in model_to_ids:
                model_to_ids[model] = []
            model_to_ids[model].append(id_hex)

    # Build bitmaps
    entries = []
    for model in sorted(model_to_ids.keys()):
        bitmap = BitMap()
        for id_hex in model_to_ids[model]:
            if id_hex in id_to_index:
                bitmap.add(id_to_index[id_hex])
        entries.append((model, bitmap))

    return write_packed_index(output_path, entries)


def build_code_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    id_to_index: dict[str, int],
) -> dict:
    """Build a packed index for vendor+model PNP ID codes (e.g., DEL01101, SAM0A7C)."""
    result = conn.execute("""
        SELECT vendor || model as pnp_code, LIST(linuxhw_id_hex ORDER BY linuxhw_id_hex)
        FROM edid.edids
        WHERE vendor IS NOT NULL AND model IS NOT NULL
        GROUP BY pnp_code
        ORDER BY pnp_code
    """).fetchall()

    entries = []
    for code, id_list in result:
        bitmap = BitMap()
        for id_hex in id_list:
            if id_hex in id_to_index:
                bitmap.add(id_to_index[id_hex])
        entries.append((code, bitmap))

    return write_packed_index(output_path, entries)


def build_packed_size_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    id_to_index: dict[str, int],
) -> dict:
    """Build a packed screen size index."""
    result = conn.execute("""
        SELECT screen_size_inches, LIST(linuxhw_id_hex ORDER BY linuxhw_id_hex)
        FROM edid.edids
        WHERE screen_size_inches IS NOT NULL
        GROUP BY screen_size_inches
        ORDER BY screen_size_inches
    """).fetchall()

    entries = []
    for size, id_list in result:
        bitmap = BitMap()
        for id_hex in id_list:
            if id_hex in id_to_index:
                bitmap.add(id_to_index[id_hex])
        entries.append((f"{size:.1f}", bitmap))

    return write_packed_index(output_path, entries)


def build_path_index(
    conn: duckdb.DuckDBPyConnection,
    output_path: Path,
    id_to_index: dict[str, int],
) -> dict:
    """Build a packed index for source paths (directory portion only).

    Paths like "Digital/Dell/DEL4080/abc123" become "Digital/Dell/DEL4080".
    This allows browsing by the linuxhw/EDID repository structure.
    """
    # Extract directory path (remove the ID filename at the end)
    result = conn.execute("""
        SELECT
            regexp_replace(source_path, '/[^/]+$', '') as dir_path,
            LIST(linuxhw_id_hex ORDER BY linuxhw_id_hex)
        FROM edid.edids
        WHERE source_path IS NOT NULL
        GROUP BY dir_path
        ORDER BY dir_path
    """).fetchall()

    entries = []
    for path, id_list in result:
        bitmap = BitMap()
        for id_hex in id_list:
            if id_hex in id_to_index:
                bitmap.add(id_to_index[id_hex])
        entries.append((path, bitmap))

    return write_packed_index(output_path, entries)
