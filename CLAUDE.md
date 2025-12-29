# EDID Dataset Project

A cross-platform EDID (Extended Display Identification Data) dataset built from the [linuxhw/EDID](https://github.com/linuxhw/EDID) repository.

## Project Structure

```
edid-dataset/
├── upstream/EDID/          # Git subtree of linuxhw/EDID
├── python/
│   ├── build/              # Build tools (ingest, generate)
│   └── edid_dataset/       # Python client library
├── data/
│   ├── edid.duckdb         # Intermediate database (separate artifact)
│   ├── buckets/            # Compact binary bucket files
│   └── metadata/           # Index files (FST, JSON)
├── js/                     # JavaScript client (future)
├── demo/                   # Web demo (future)
└── docs/                   # Documentation
```

## Build Pipeline

1. **Ingest**: Parse EDID repo → DuckDB database
   ```bash
   cd python && uv run python -m build.cli ingest -i ../upstream/EDID -o ../data/edid.duckdb
   ```

2. **Generate**: DuckDB → Compact binary outputs
   ```bash
   cd python && uv run python -m build.cli generate -d ../data/edid.duckdb -o ../data
   ```

## Key Design Decisions

- **DuckDB intermediate**: SQL-queryable, analytics-ready, distributable as separate artifact
- **Bucketed storage**: 256 bucket files by MD5 prefix, ~110KB each for partial loading
- **FST indexes**: Finite State Transducers for compact prefix-searchable string indexes
- **Roaring bitmaps**: Compressed integer sets for efficient key retrieval

## Git Workflow

- Commit frequently after completing logical units of work
- Use git subtree for upstream EDID repo (pinnable, updatable)
- Don't include co-authored-by in commits

## Dependencies

- Python 3.11+
- DuckDB, pyroaring, click, tqdm
- Use `uv` for Python package management

## License

Polyform Shield 1.0.0
