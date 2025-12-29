# EDID Dataset Binary Format

This document describes the binary formats used by the EDID dataset.

## Directory Structure

```
data/
  manifest.json           # Dataset metadata
  buckets/
    00.bin ... ff.bin     # 256 bucket files (by MD5 prefix)
  metadata/
    vendors.idx           # Packed index: path vendor names
    products.idx          # Packed index: product names (vendor prefix stripped)
    codes.idx             # Packed index: PNP ID codes (e.g., DEL01101)
    sizes.idx             # Packed index: screen sizes in inches
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

## Bucket File Format

Each bucket file (`{00..ff}.bin`) contains all EDIDs whose MD5 hash starts with that byte prefix. Files are designed for efficient binary search.

### Header (16 bytes)

| Offset | Size | Type   | Description               |
|--------|------|--------|---------------------------|
| 0      | 4    | bytes  | Magic: `EDIB`             |
| 4      | 2    | u16le  | Version (currently 1)     |
| 6      | 2    | u16le  | Entry count               |
| 8      | 4    | u32le  | Values section offset     |
| 12     | 4    | bytes  | Reserved (zeros)          |

### Keys Section (15 bytes per entry)

Immediately follows header. Each key is the remaining 15 bytes of the MD5 hash (first byte is the bucket prefix). Keys are sorted for binary search.

### Metadata Section (16 bytes per entry)

| Offset | Size | Type   | Description               |
|--------|------|--------|---------------------------|
| 0      | 2    | u16le  | Vendor ID (reserved)      |
| 2      | 2    | u16le  | Model ID (reserved)       |
| 4      | 2    | u16le  | Manufacture year          |
| 6      | 2    | u16le  | Width in pixels           |
| 8      | 2    | u16le  | Height in pixels          |
| 10     | 2    | u16le  | Width in mm               |
| 12     | 2    | u16le  | Height in mm              |
| 14     | 1    | u8     | Display type (0=analog, 1=digital, 2=unknown) |
| 15     | 1    | u8     | Flags (reserved)          |

### Offsets Section (4 bytes per entry)

Packed offset + length for each EDID's raw bytes:
- Bits 0-23: Offset from values section start
- Bits 24-31: Length divided by 4 (EDID lengths are always multiples of 4)

### Values Section

Raw EDID bytes, 4-byte aligned. Typical EDID is 128 or 256 bytes.

## Packed Index File Format (.idx)

Each index file contains all entries for one dimension (vendors, products, codes, or sizes) packed into a single file with embedded Roaring bitmaps.

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

UTF-8 encoded strings, packed contiguously. Each string is the key for its corresponding entry (vendor name, product name, PNP code, or screen size).

### Bitmaps Section

Serialized [Roaring Bitmaps](https://roaringbitmap.org/), packed contiguously. Each bitmap contains the global indices of entries matching that key.

## Index Descriptions

| Index | Key Example | Description |
|-------|-------------|-------------|
| `vendors.idx` | "Dell", "Samsung" | Vendor names from linuxhw/EDID directory structure |
| `products.idx` | "U2412M", "27GL850" | Product names with vendor prefix stripped |
| `codes.idx` | "DEL01101", "SAM0A7C" | PNP ID codes (vendor 3-letter + model number from EDID) |
| `sizes.idx` | "27.0", "32.0" | Diagonal screen size in inches (rounded to 0.5") |

## Lookup Algorithm

### By MD5 Hash

1. Parse first byte as bucket prefix
2. Load bucket file `{prefix:02x}.bin`
3. Binary search keys section for remaining 15 bytes
4. Read metadata and value offset at found index
5. Return EDID data

### By Dimension (Vendor/Product/Code/Size)

1. Load packed index file (e.g., `products.idx`)
2. Binary search entry table by string key
3. Deserialize Roaring bitmap for matching entry
4. AND bitmaps together for multi-dimension queries
5. For each index in result bitmap, determine bucket and position
6. Look up individual entries

## Size Estimates

| Component | Size |
|-----------|------|
| Buckets (256 files) | ~35 MB |
| Vendor index | ~254 KB |
| Product index | ~802 KB |
| Code index | ~1.2 MB |
| Size index | ~228 KB |
| **Total** | **~37 MB** |
