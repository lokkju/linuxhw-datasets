# LinuxHW Datasets

A collection of datasets built from [linuxhw](https://github.com/linuxhw) repositories, starting with EDID (Extended Display Identification Data) from [linuxhw/EDID](https://github.com/linuxhw/EDID).

## Project Structure

```
linuxhw-datasets/
├── upstream/EDID/              # Git submodule of linuxhw/EDID
├── src/
│   ├── edid_build/             # Build tools (ingest, generate, cli)
│   └── edid_dataset/           # Python client library
├── data/
│   ├── ducklake/               # DuckLake format
│   │   ├── edid.ducklake       # Catalog (time-travel, versioned)
│   │   ├── edids/              # Parquet files
│   │   └── versions.json       # Version history
│   └── roaringbuckets/         # RoaringBuckets format
│       ├── buckets/            # 256 bucket files
│       ├── metadata/           # Index files
│       └── manifest.json       # Dataset manifest
└── docs/                       # Documentation
```

## Quick Start

```bash
# Clone with submodule
git clone --recursive https://github.com/lokkju/linuxhw-datasets

# Install dependencies
uv sync

# Check for updates and ingest
uv run edid-build update
```

## CLI Commands

All commands use sensible defaults and can be run without arguments:

```bash
# Check for upstream updates and re-ingest if needed
uv run edid-build update

# Check for updates without applying
uv run edid-build update --check-only

# Force re-ingest even if no changes
uv run edid-build update --force

# Manual ingest (defaults: upstream/EDID → data/ducklake/)
uv run edid-build ingest

# Generate compact binary bucket files
uv run edid-build generate

# Show database statistics
uv run edid-build stats
```

## Update Workflow

The `update` command automates the full update process:

1. **Fetch**: Gets latest commits from linuxhw/EDID remote
2. **Compare**: Checks if submodule is behind remote HEAD
3. **Update**: If changes found, updates submodule to latest
4. **Ingest**: Runs incremental ingest (only processes added/modified/deleted)

```bash
# Typical output when updates are available:
$ uv run edid-build update
Current commit: cc83e52221a9
Fetching from remote...
Remote commit:  ab12def34567

3 new commit(s) available:
  ab12def Add new Samsung monitors
  cd34567 Fix Dell EDID data
  ef78901 Add LG displays

Updating submodule...
Updated to: ab12def34567 (2025-02-15)

Running ingest...
Incremental update - computing diff...
  Added: 156, Modified: 3, Deleted: 0

Update complete:
  Previous commit: cc83e52221a9
  New commit:      ab12def34567 (2025-02-15)
  Total EDIDs:     141,896
  Added:           156
  Modified:        3
  Deleted:         0
```

## Versioning Scheme

The dataset uses three version components:

| Component | Example | Location |
|-----------|---------|----------|
| Format version | `v1` | `versions.json`, `manifest.json` |
| Data version | `2026.01.03-cc83e52221a9` | `versions.json`, `manifest.json` |
| Git tag | `v2026.01.03-cc83e52221a9` | GitHub releases |

- **Format version**: Public binary format identifier (v1 = current EDIB, v2 = future RBLB)
- **Data version**: Build date (YYYY.MM.DD) + upstream commit hash (12 chars)
- **Git tag**: Data version with 'v' prefix

Key files:
- `data/ducklake/versions.json`: Contains `current`, `format_version`, and version history
- `data/roaringbuckets/manifest.json`: Contains `format_version`, `data_version`, `upstream`

## R2 Publishing

Datasets are published to Cloudflare R2 with URL structure:
```
/edid/{format_version}/{data_version}/ducklake/
/edid/{format_version}/{data_version}/roaringbuckets/
/edid/{format_version}/latest  # Marker file with current version
```

Scripts:
- `scripts/publish-r2.sh` - Upload to R2
- `scripts/release.sh --publish` - Build and publish in one step

## Key Design Decisions

- **DuckLake**: Versioned data lake with time-travel support, parquet storage
- **Incremental updates**: Diff detection (added/modified/deleted) for efficient updates
- **Custom file naming**: `edid_{YYYYMMDD}-{commit}_{batch}.parquet` for chronological sorting
- **PyArrow + ducklake_add_data_files**: External parquet writing with DuckLake registration
- **Bucketed storage**: 256 bucket files by MD5 prefix for partial loading
- **Format versioning**: v1 = current EDIB format, v2 = future RBLB format

## Git Workflow

- Commit frequently after completing logical units of work
- Use git submodule for upstream EDID repo (pinnable, updatable)
- Clone with: `git clone --recursive`
- Manual submodule update: `git submodule update --remote upstream/EDID`

## Dependencies

- Python 3.11+
- DuckDB, DuckLake extension, PyArrow, pyroaring, click, tqdm
- Use `uv` for Python package management

## License

Polyform Shield 1.0.0
