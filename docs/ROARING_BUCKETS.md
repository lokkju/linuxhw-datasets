# RoaringBuckets Format Specification

RoaringBuckets is a compact binary format for distributing datasets with fast lookup capabilities. It combines hash-based bucketing with [Roaring Bitmaps](https://roaringbitmap.org/) for efficient multi-dimensional search.

## Overview

The format is designed for:
- **Partial loading**: Only fetch the buckets you need
- **Fast lookups**: O(1) hash-based access, binary search within buckets
- **Compressed indexes**: Roaring bitmaps for efficient set operations
- **Browser-compatible**: Works with `fetch()` and `ArrayBuffer`

## Directory Structure

```
data/roaringbuckets/
  manifest.json           # Dataset metadata
  buckets/
    00.bin ... ff.bin     # 256 bucket files (by ID prefix)
  metadata/
    vendors.idx           # Packed index: vendor names
    products.idx          # Packed index: product names
    codes.idx             # Packed index: PNP ID codes
    sizes.idx             # Packed index: screen sizes
    paths.idx             # Packed index: directory paths
```

## Manifest (manifest.json)

```json
{
  "version": 4,
  "total_entries": 141753,
  "buckets": 256,
  "indexes": {
    "vendors": {"count": 572, "total_bytes": 253577, "strings_bytes": 3031, "bitmaps_bytes": 243666},
    "products": {"count": 12997, "total_bytes": 801623, "strings_bytes": 99259, "bitmaps_bytes": 546384},
    "codes": {"count": 21604, "total_bytes": 1155234, "strings_bytes": 157390, "bitmaps_bytes": 738580},
    "sizes": {"count": 139, "total_bytes": 227512, "strings_bytes": 544, "bitmaps_bytes": 225284}
  }
}
```

## Bucket File Format (v4)

Each bucket file (`{00..ff}.bin`) contains all entries whose 6-byte linuxhw ID starts with that byte prefix. Files are designed for efficient binary search.

### Header (16 bytes)

| Offset | Size | Type   | Description               |
|--------|------|--------|---------------------------|
| 0      | 4    | bytes  | Magic: `EDIB`             |
| 4      | 2    | u16le  | Version (currently 4)     |
| 6      | 2    | u16le  | Entry count               |
| 8      | 4    | u32le  | Values section offset     |
| 12     | 4    | u32le  | Vendor table offset       |

### Keys Section (5 bytes per entry)

Immediately follows header. Each key is bytes 1-5 of the 6-byte linuxhw ID (byte 0 is the bucket prefix). Keys are sorted for binary search.

### Vendor Indexes Section (1 byte per entry)

Index into the vendor string table at the end of the file. Allows reconstructing the full path (e.g., `Digital/{vendor_name}/{model}/{id}`).

### Offsets Section (4 bytes per entry)

Packed offset + length for each entry's raw data:
- Bits 0-23: Offset from values section start
- Bits 24-31: Length divided by 4 (lengths are always multiples of 4)

### Values Section

Raw data bytes, 4-byte aligned. For EDID, typical sizes are 128 or 256 bytes.

### Vendor String Table

Located at `vendor_table_offset`:
- 1 byte: Vendor count
- For each vendor:
  - 1 byte: String length
  - N bytes: UTF-8 encoded vendor name

## Packed Index File Format (.idx)

Each index file contains all entries for one dimension (vendors, products, codes, sizes, or paths) packed into a single file with embedded Roaring bitmaps.

### Header (16 bytes)

| Offset | Size | Type   | Description               |
|--------|------|--------|---------------------------|
| 0      | 4    | bytes  | Magic: `EIDX`             |
| 4      | 2    | u16le  | Version (currently 1)     |
| 6      | 4    | u32le  | Entry count               |
| 10     | 6    | bytes  | Reserved (zeros)          |

### Entry Table (12 bytes per entry)

| Offset | Size | Type   | Description               |
|--------|------|--------|---------------------------|
| 0      | 4    | u32le  | String offset (absolute)  |
| 4      | 2    | u16le  | String length             |
| 6      | 4    | u32le  | Bitmap offset (absolute)  |
| 10     | 2    | u16le  | Bitmap length             |

### Strings Section

UTF-8 encoded strings, packed contiguously. Each string is the key for its corresponding entry.

### Bitmaps Section

Serialized [Roaring Bitmaps](https://roaringbitmap.org/) in standard portable format, packed contiguously. Each bitmap contains the global indices of entries matching that key.

## Roaring Bitmap Encoding

Roaring bitmaps use a hybrid encoding for optimal compression:

1. **Container selection**: Values are partitioned into 65536-element chunks
2. **Array containers**: For sparse chunks (<4096 elements), store sorted u16 values
3. **Bitmap containers**: For dense chunks, use 8KB bitmaps
4. **Run containers**: For sequential runs, store (start, length) pairs

The format is standardized and supported by libraries in many languages:
- JavaScript: [roaring-wasm](https://www.npmjs.com/package/roaring-wasm)
- Python: [pyroaring](https://pypi.org/project/pyroaring/)
- Rust: [roaring-rs](https://crates.io/crates/roaring)

## Lookup Algorithms

### By LinuxHW ID

```
1. Parse first byte as bucket prefix
2. Load bucket file `{prefix:02x}.bin`
3. Binary search keys section for bytes 1-5
4. Read value offset at found index
5. Return raw data (decode client-side as needed)
6. Use vendor index to reconstruct full path
```

### By Dimension (Vendor/Product/Code/Size)

```
1. Load packed index file (e.g., `products.idx`)
2. Binary search entry table by string key
3. Deserialize Roaring bitmap for matching entry
4. AND bitmaps together for multi-dimension queries
5. For each global index in result bitmap:
   a. Determine bucket (index // entries_per_bucket)
   b. Look up entry within bucket
```

## Size Estimates (EDID Dataset)

| Component | Size |
|-----------|------|
| Buckets (256 files) | ~28 MB |
| Vendor index | ~254 KB |
| Product index | ~802 KB |
| Code index | ~1.2 MB |
| Size index | ~228 KB |
| Path index | ~1 MB |
| **Total** | **~31 MB** |

## Version History

| Version | Changes |
|---------|---------|
| 1 | Initial format with metadata in bucket files |
| 2 | Removed metadata section, client-side decoding |
| 3 | Changed to linuxhw_id-based keys (6 bytes) |
| 4 | Added per-entry vendor index and vendor string table |

## Reference Implementations

- **JavaScript**: [linuxhw-browser](https://github.com/lokkju/linuxhw-browser) (`src/bucket-loader.js`, `src/index-loader.js`)
- **Python Generator**: [linuxhw-datasets](https://github.com/lokkju/linuxhw-datasets) (`src/edid_build/generate.py`)
