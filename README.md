# LinuxHW Dataset

A comprehensive EDID (Extended Display Identification Data) dataset built from the [linuxhw/EDID](https://github.com/linuxhw/EDID) repository, providing 140,000+ display profiles in two formats.

## Data Formats

### DuckLake

A versioned data lake with full SQL query capabilities.

**Best for:** Data analysis, exploration, custom queries, research

| Feature | Details |
|---------|---------|
| Query language | Full SQL via DuckDB |
| Size | ~150 MB |
| Updates | Incremental, versioned, time-travel |
| Schema | 19 columns with rich metadata |

```sql
-- Remote access example
INSTALL ducklake; LOAD ducklake;

ATTACH 'https://github.com/lokkju/linuxhw-dataset/raw/main/data/edid.ducklake' AS edid (
    TYPE ducklake,
    DATA_PATH 'https://github.com/lokkju/linuxhw-dataset/raw/main/data'
);

SELECT vendor, model, width_px, height_px, manufacture_year
FROM edid.edids
WHERE vendor = 'Dell'
ORDER BY manufacture_year DESC
LIMIT 10;
```

[Full documentation](docs/DUCKLAKE.md)

### RoaringBuckets

A compact binary format for web and embedded applications.

**Best for:** Web apps, fast lookups, offline use, low memory

| Feature | Details |
|---------|---------|
| Lookup | O(1) hash + binary search |
| Size | ~31 MB |
| Dependencies | None (pure binary) |
| Browser support | Yes, via fetch + ArrayBuffer |

[Format specification](docs/ROARING_BUCKETS.md)

## Quick Start

### Clone and Setup

```bash
git clone --recursive https://github.com/lokkju/linuxhw-dataset
cd linuxhw-dataset
uv sync
```

### Update Dataset

```bash
# Check for upstream updates and re-ingest if changes found
uv run edid-build update

# Force full re-ingest
uv run edid-build update --force
```

### Generate RoaringBuckets

```bash
uv run edid-build generate
```

### View Statistics

```bash
uv run edid-build stats
```

## Related Projects

- **[linuxhw-browser](https://github.com/lokkju/linuxhw-browser)** - Web-based EDID browser using RoaringBuckets format
- **[linuxhw/EDID](https://github.com/linuxhw/EDID)** - Original EDID collection from Linux hardware probes

## Project Structure

```
linuxhw-dataset/
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
