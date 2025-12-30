# LinuxHW Datasets

Datasets built from [linuxhw](https://github.com/linuxhw) repositories. Currently features 140,000+ EDID display profiles from [linuxhw/EDID](https://github.com/linuxhw/EDID) in two formats.

## Data Formats

### RoaringBuckets

A compact binary format optimized for web applications and embedded use.

**Key advantages:**
- **Zero dependencies** - Pure binary format, no database or runtime required
- **Partial loading** - Fetch only the buckets you need (256 files, ~120KB each)
- **Browser-ready** - Works with `fetch()` + `ArrayBuffer`, no WASM needed
- **Multi-dimensional search** - Roaring bitmaps enable fast filtering by vendor, model, resolution
- **CDN-friendly** - Static files with long cache lifetimes
- **Offline capable** - Cache locally for offline use

| Feature | Details |
|---------|---------|
| Lookup | O(1) hash + binary search |
| Size | ~31 MB total |
| Per-bucket | ~120 KB average |
| Browser support | All modern browsers |

[Format specification](docs/ROARING_BUCKETS.md) | [Example: linuxhw-browser](https://github.com/lokkju/linuxhw-browser)

### DuckLake

A versioned data lake with full SQL query capabilities via DuckDB.

**Best for:** Data analysis, exploration, custom queries, research

| Feature | Details |
|---------|---------|
| Query language | Full SQL via DuckDB |
| Size | ~150 MB |
| Schema | 19 columns with rich metadata |
| Versioning | Time-travel, incremental updates |

```sql
-- Remote access
INSTALL ducklake; LOAD ducklake;

ATTACH 'https://github.com/lokkju/linuxhw-datasets/raw/main/data/edid.ducklake' AS edid (
    TYPE ducklake,
    DATA_PATH 'https://github.com/lokkju/linuxhw-datasets/raw/main/data'
);

-- Find Dell monitors by resolution
SELECT path_vendor, product_name, width_px, height_px, manufacture_year
FROM edid.edids
WHERE path_vendor = 'Dell'
ORDER BY manufacture_year DESC
LIMIT 10;

-- Time-travel: see what changed between versions
SELECT * FROM ducklake_snapshots('edid');  -- List all versions

-- Query a previous version
SELECT COUNT(*) FROM edid.edids AT VERSION 1;

-- Compare versions to see new entries
SELECT COUNT(*) as new_entries
FROM edid.edids
WHERE linuxhw_id NOT IN (SELECT linuxhw_id FROM edid.edids AT VERSION 1);
```

[Full documentation](docs/DUCKLAKE.md)

## Quick Start

```bash
git clone --recursive https://github.com/lokkju/linuxhw-datasets
cd linuxhw-datasets
uv sync

# Check for upstream updates and re-ingest
uv run edid-build update

# Generate RoaringBuckets files
uv run edid-build generate

# View statistics
uv run edid-build stats
```

## Related Projects

- **[linuxhw-browser](https://github.com/lokkju/linuxhw-browser)** - Web-based EDID browser using RoaringBuckets
- **[linuxhw/EDID](https://github.com/linuxhw/EDID)** - Original EDID collection from Linux hardware probes

## Project Structure

```
linuxhw-datasets/
├── upstream/EDID/          # Git submodule of linuxhw/EDID
├── src/
│   ├── edid_build/         # Build tools (ingest, generate, cli)
│   └── edid_dataset/       # Python client library
├── data/
│   ├── edid.ducklake       # DuckLake catalog
│   ├── edids/              # Parquet data files
│   └── buckets/            # RoaringBuckets binary files
└── docs/
    ├── DUCKLAKE.md         # DuckLake documentation
    └── ROARING_BUCKETS.md  # Binary format specification
```

## License

[Polyform Shield 1.0.0](LICENSE)
