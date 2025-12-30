# EDID Dataset Project

A cross-platform EDID (Extended Display Identification Data) dataset built from the [linuxhw/EDID](https://github.com/linuxhw/EDID) repository.

## Project Structure

```
edid-dataset/
├── upstream/EDID/          # Git submodule of linuxhw/EDID
├── src/
│   ├── edid_build/         # Build tools (ingest, generate, cli)
│   └── edid_dataset/       # Python client library
├── data/
│   ├── edid.ducklake       # DuckLake catalog (time-travel, versioned)
│   ├── edids/              # Parquet files (edid_{date}-{commit}_{batch}.parquet)
│   └── main/edids/         # DuckLake delete markers
├── js/                     # JavaScript client (future)
├── demo/                   # Web demo
└── docs/                   # Documentation
```

## Quick Start

```bash
# Clone with submodule
git clone --recursive https://github.com/lokkju/edid-dataset

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

# Manual ingest (defaults: upstream/EDID → data/edid.ducklake)
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

## Key Design Decisions

- **DuckLake**: Versioned data lake with time-travel support, parquet storage
- **Incremental updates**: Diff detection (added/modified/deleted) for efficient updates
- **Custom file naming**: `edid_{YYYYMMDD}-{commit}_{batch}.parquet` for chronological sorting
- **PyArrow + ducklake_add_data_files**: External parquet writing with DuckLake registration
- **Bucketed storage**: 256 bucket files by MD5 prefix for partial loading

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
