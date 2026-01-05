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
-- Remote access (using latest)
INSTALL ducklake; LOAD ducklake;

ATTACH 'https://roaringbuckets.placist.org/datasets/linuxhw/edid/v1/latest/ducklake/edid.ducklake' AS edid (
    TYPE ducklake,
    DATA_PATH 'https://roaringbuckets.placist.org/datasets/linuxhw/edid/v1/latest/ducklake',
    OVERRIDE_DATA_PATH 1
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
SELECT COUNT(*) FROM edid.edids AT (VERSION => 1);

-- Compare versions to see new entries
SELECT COUNT(*) as new_entries
FROM edid.edids
WHERE linuxhw_id NOT IN (SELECT linuxhw_id FROM edid.edids AT (VERSION => 1));
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

## Versioning

The dataset uses a three-part versioning scheme:

| Component | Example | Description |
|-----------|---------|-------------|
| Format version | `v1` | Binary format version (v1 = current, v2 = future RBLB format) |
| Data version | `2026.01.03-cc83e52221a9` | Build date + upstream commit hash |
| Git tag | `v2026.01.03-cc83e52221a9` | Tag with 'v' prefix for releases |

Check current version:
```bash
uv run edid-build version
# Data version:   2026.01.03-cc83e52221a9
# Format version: v1
```

## Updating & Releases

### Download Pre-built Releases

Pre-built datasets are available as [GitHub Releases](https://github.com/lokkju/linuxhw-datasets/releases):

- `linuxhw-edid-ducklake-v{version}.tar.gz` - DuckLake format (~8 MB compressed)
- `linuxhw-edid-roaringbuckets-v{version}.tar.gz` - RoaringBuckets format (~13 MB compressed)

### Manual Update

To update from the latest upstream and create a release:

```bash
# Check for updates (no changes made)
./scripts/release.sh --check-only

# Update, rebuild, and prepare release
./scripts/release.sh

# Then follow the printed instructions to push and create release
git push
gh release create 'v2026.01.03-abc123def456' ...

# Or update and publish to R2 in one step
./scripts/release.sh --publish
```

The release script:
1. Fetches latest from [linuxhw/EDID](https://github.com/linuxhw/EDID)
2. Updates the submodule if changes found
3. Runs `edid-build ingest` (DuckLake) and `edid-build generate` (RoaringBuckets)
4. Creates release archives in `dist/`
5. Commits changes locally
6. Prints commands to push and create GitHub release

Options:
- `--force` - Rebuild even if no upstream changes
- `--no-commit` - Skip git commit
- `--publish` - Upload to R2 after building

### R2 Publishing

To publish datasets to Cloudflare R2:

1. Create an R2 bucket in Cloudflare Dashboard
2. Create R2 API token: Dashboard → R2 → Manage R2 API Tokens
   - Permissions: **Object Read & Write**
   - Scope: Specific bucket (e.g., `roaringbuckets`) or all buckets
3. Configure credentials:

```bash
cp .env.example .env
```

Required environment variables:
| Variable | Description |
|----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID (from dashboard URL) |
| `R2_ACCESS_KEY_ID` | R2 API access key |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key |
| `R2_BUCKET` | Bucket name (default: `roaringbuckets`) |
| `R2_BASE_PATH` | Path prefix in bucket (default: `datasets/linuxhw/edid`) |
| `R2_PUBLIC_URL` | Public URL for display (optional, e.g., `https://example.com`) |

```bash
# Publish current version
./scripts/publish-r2.sh

# Check what would be uploaded
./scripts/publish-r2.sh --check
```

URL structure: `/{base_path}/{format_version}/{data_version}/`
Example: `/datasets/linuxhw/edid/v1/2026.01.05-cc83e52221a9/ducklake/`
Latest:  `/datasets/linuxhw/edid/v1/latest/ducklake/`

## Related Projects

- **[linuxhw-browser](https://github.com/lokkju/linuxhw-browser)** - Web-based EDID browser using RoaringBuckets
- **[linuxhw/EDID](https://github.com/linuxhw/EDID)** - Original EDID collection from Linux hardware probes

## Project Structure

```
linuxhw-datasets/
├── upstream/EDID/              # Git submodule of linuxhw/EDID
├── src/
│   ├── edid_build/             # Build tools (ingest, generate, cli)
│   └── edid_dataset/           # Python client library
├── data/
│   ├── ducklake/               # DuckLake format
│   │   ├── edid.ducklake       # Catalog file
│   │   ├── edids/              # Parquet data files
│   │   └── versions.json       # Version history
│   └── roaringbuckets/         # RoaringBuckets format
│       ├── buckets/            # 256 bucket files
│       ├── metadata/           # Index files
│       └── manifest.json       # Dataset manifest
└── docs/
    ├── DUCKLAKE.md             # DuckLake documentation
    └── ROARING_BUCKETS.md      # Binary format specification
```

## License

[Polyform Shield 1.0.0](LICENSE)
