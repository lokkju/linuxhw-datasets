# DuckLake Implementation

This document describes the DuckLake-based storage format used by the LinuxHW Dataset for versioned, queryable EDID data.

## Overview

[DuckLake](https://duckdb.org/docs/extensions/ducklake.html) is a DuckDB extension that provides:
- **Versioned data lake**: Time-travel and version history
- **Parquet storage**: Columnar format with excellent compression
- **SQL interface**: Full DuckDB query capabilities
- **External file registration**: Write Parquet externally, register with catalog

## Quick Start

### Remote Access

```sql
-- Install and load DuckLake extension
INSTALL ducklake;
LOAD ducklake;

-- Attach the remote dataset
ATTACH 'https://github.com/lokkju/linuxhw-dataset/raw/main/data/edid.ducklake' AS edid (
    TYPE ducklake,
    DATA_PATH 'https://github.com/lokkju/linuxhw-dataset/raw/main/data'
);

-- Query displays
SELECT vendor, model, width_px, height_px, manufacture_year
FROM edid.edids
WHERE vendor = 'Samsung'
ORDER BY manufacture_year DESC
LIMIT 10;
```

### Local Access

```sql
INSTALL ducklake;
LOAD ducklake;

ATTACH 'data/edid.ducklake' AS edid (
    TYPE ducklake,
    DATA_PATH 'data'
);

SELECT COUNT(*) FROM edid.edids;
```

## Schema

The `edid.edids` table contains 19 columns:

| Column | Type | Description |
|--------|------|-------------|
| `linuxhw_id` | BLOB | 6-byte unique identifier (MD5-derived) |
| `linuxhw_id_hex` | VARCHAR | Hex string of linuxhw_id |
| `raw_edid` | BLOB | Raw EDID bytes (128-512 bytes) |
| `vendor` | VARCHAR | 3-letter vendor code from EDID (e.g., "DEL") |
| `model` | VARCHAR | Product code from EDID (e.g., "01101") |
| `product_name` | VARCHAR | Human-readable product name from descriptors |
| `serial_number` | VARCHAR | Serial number from EDID descriptors |
| `manufacture_year` | INT32 | Year of manufacture (1990-2050) |
| `manufacture_week` | INT32 | Week of manufacture (1-53) |
| `path_vendor` | VARCHAR | Vendor name from directory path |
| `path_model` | VARCHAR | Model name from directory path |
| `width_px` | INT32 | Native width in pixels |
| `height_px` | INT32 | Native height in pixels |
| `width_mm` | INT32 | Physical width in millimeters |
| `height_mm` | INT32 | Physical height in millimeters |
| `display_type` | VARCHAR | "Digital" or "Analog" |
| `screen_size_inches` | FLOAT32 | Diagonal size in inches |
| `source_path` | VARCHAR | Original file path in linuxhw/EDID |
| `checksum_valid` | BOOL | Whether EDID checksum validates |

## File Organization

```
data/
├── edid.ducklake           # DuckLake catalog file
├── edid.ducklake.wal       # Write-ahead log (during writes)
├── edids/                  # Parquet data files
│   ├── edid_20250106-cc83e52221a9_001.parquet
│   ├── edid_20250106-cc83e52221a9_002.parquet
│   └── ...
├── main/edids/             # DuckLake delete markers
│   └── *_deletions.parquet
└── versions.json           # Version tracking
```

### Parquet File Naming

Files follow the pattern: `edid_{YYYYMMDD}-{commit}_{batch:03d}.parquet`

- `YYYYMMDD`: Date the upstream commit was made
- `commit`: First 12 characters of git commit hash
- `batch`: Sequential batch number (001, 002, ...)

This naming ensures:
- Chronological sorting by date
- Traceability to upstream commits
- Predictable incremental updates

### Compression

All Parquet files use Zstd compression, balancing:
- Compression ratio (~3-4x)
- Fast decompression
- Streaming-friendly

## Incremental Updates

The dataset supports incremental updates that only process changed files:

### Update Detection

```
1. Get current git commit from versions.json
2. Fetch latest from linuxhw/EDID remote
3. Compute diff: added, modified, deleted files
4. Process only changed entries
```

### Update Process

```sql
-- Within a transaction:
BEGIN;

-- Delete modified/removed entries
DELETE FROM edid.edids WHERE linuxhw_id IN (...);

-- Write new parquet files for added/modified entries
-- (done externally with PyArrow)

-- Register new files
CALL ducklake_add_data_files('edid', 'edids', 'edids/edid_20250215-ab12def34567_001.parquet');

COMMIT;
```

### Version Tracking

`versions.json` tracks update history:

```json
{
  "current_commit": "cc83e52221a9",
  "current_version": 3,
  "versions": [
    {"version": 1, "commit": "abc123def456", "timestamp": "2025-01-01T10:00:00Z"},
    {"version": 2, "commit": "def456abc789", "timestamp": "2025-01-05T15:30:00Z"},
    {"version": 3, "commit": "cc83e52221a9", "timestamp": "2025-01-06T12:00:00Z"}
  ]
}
```

## Time Travel

DuckLake maintains version history, enabling queries against past states:

```sql
-- Query data as of version 2
SELECT COUNT(*) FROM edid.edids VERSION 2;

-- See version history
SELECT * FROM ducklake_versions('edid');
```

## Query Examples

### Find displays by resolution

```sql
SELECT vendor, model, product_name, width_px, height_px
FROM edid.edids
WHERE width_px = 3840 AND height_px = 2160
ORDER BY manufacture_year DESC;
```

### Vendor statistics

```sql
SELECT
    path_vendor,
    COUNT(*) as count,
    MIN(manufacture_year) as first_year,
    MAX(manufacture_year) as last_year
FROM edid.edids
GROUP BY path_vendor
ORDER BY count DESC
LIMIT 20;
```

### Resolution distribution

```sql
SELECT
    width_px || 'x' || height_px as resolution,
    COUNT(*) as count
FROM edid.edids
WHERE width_px IS NOT NULL
GROUP BY width_px, height_px
ORDER BY count DESC
LIMIT 20;
```

### Screen size histogram

```sql
SELECT
    ROUND(screen_size_inches) as size_inches,
    COUNT(*) as count
FROM edid.edids
WHERE screen_size_inches IS NOT NULL
GROUP BY ROUND(screen_size_inches)
ORDER BY size_inches;
```

## Python API

```python
import duckdb

conn = duckdb.connect()
conn.execute("INSTALL ducklake; LOAD ducklake")
conn.execute("""
    ATTACH 'data/edid.ducklake' AS edid (
        TYPE ducklake,
        DATA_PATH 'data'
    )
""")

# Query to DataFrame
df = conn.execute("""
    SELECT vendor, model, width_px, height_px, manufacture_year
    FROM edid.edids
    WHERE manufacture_year >= 2020
""").df()
```

## Comparison with RoaringBuckets

| Feature | DuckLake | RoaringBuckets |
|---------|----------|----------------|
| **Query language** | Full SQL | Hash lookup + bitmap AND |
| **Partial loading** | Column pruning | Bucket-level |
| **Use case** | Analysis, exploration | Fast web lookups |
| **Size** | ~150 MB | ~31 MB |
| **Dependencies** | DuckDB + extension | None (pure binary) |
| **Updates** | Incremental, versioned | Full regeneration |

## Reference

- [DuckLake Extension](https://duckdb.org/docs/extensions/ducklake.html)
- [Parquet Format](https://parquet.apache.org/)
- [linuxhw/EDID Repository](https://github.com/linuxhw/EDID)
