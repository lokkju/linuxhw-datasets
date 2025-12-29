# EDID Dataset Binary Format

This document describes the binary formats used by the EDID dataset.

## Directory Structure

```
data/
  manifest.json           # Dataset metadata
  buckets/
    00.bin ... ff.bin     # 256 bucket files (by MD5 prefix)
  metadata/
    indexes/
      vendors/
        *.roaring         # Roaring bitmap per vendor
        _manifest.json    # Vendor index manifest
      models/
        *.roaring         # Roaring bitmap per model
        _manifest.json    # Model index manifest
      sizes/
        *.roaring         # Roaring bitmap per screen size
        _manifest.json    # Size index manifest
```

## Manifest (manifest.json)

```json
{
  "version": 2,
  "total_entries": 141753,
  "buckets": 256,
  "indexes": {
    "vendors": {"count": 572, "total_bytes": 243666},
    "models": {"count": 21607, "total_bytes": 738634},
    "sizes": {"count": 139, "total_bytes": 225284}
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

## Roaring Bitmap Indexes

Indexes map dimension values (vendor, model, screen size) to sets of entry indices.

### Index Manifest (_manifest.json)

```json
{
  "Dell": {"file": "Dell.roaring", "count": 5432},
  "Samsung": {"file": "Samsung.roaring", "count": 3210},
  ...
}
```

### Roaring Files (*.roaring)

Standard [Roaring Bitmap](https://roaringbitmap.org/) serialization format. Each bitmap contains the indices of entries matching that dimension value.

Entry indices correspond to the global sorted order by MD5 hash (same order as bucket files).

## Lookup Algorithm

### By MD5 Hash

1. Parse first byte as bucket prefix
2. Load bucket file `{prefix:02x}.bin`
3. Binary search keys section for remaining 15 bytes
4. Read metadata and value offset at found index
5. Return EDID data

### By Dimension (Vendor/Model/Size)

1. Load Roaring bitmap for desired value
2. AND bitmaps together for multi-dimension queries
3. For each index in result bitmap, determine bucket and position
4. Look up individual entries

## Size Estimates

| Component | Size |
|-----------|------|
| Buckets (256 files) | ~35 MB |
| Vendor index | ~244 KB |
| Model index | ~739 KB |
| Size index | ~225 KB |
| **Total** | **~36 MB** |
