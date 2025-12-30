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

## Build Pipeline

1. **Ingest**: Parse EDID repo → DuckLake database
   ```bash
   uv run edid-build ingest -i upstream/EDID -o data/edid.ducklake
   ```

2. **Generate**: DuckLake → Compact binary outputs (buckets)
   ```bash
   uv run edid-build generate -d data/edid.ducklake -o data
   ```

3. **Stats**: Show database statistics
   ```bash
   uv run edid-build stats --db data/edid.ducklake
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
- Update EDID data: `git submodule update --remote upstream/EDID`

## Dependencies

- Python 3.11+
- DuckDB, DuckLake extension, PyArrow, pyroaring, click, tqdm
- Use `uv` for Python package management

## License

Polyform Shield 1.0.0
