"""CLI for EDID dataset build tools."""

from pathlib import Path

import click


@click.group()
def main():
    """EDID Dataset build tools."""
    pass


@main.command()
@click.option(
    "--input",
    "-i",
    "input_path",
    type=click.Path(exists=True, path_type=Path),
    required=True,
    help="Path to linuxhw/EDID repository",
)
@click.option(
    "--output",
    "-o",
    "output_path",
    type=click.Path(path_type=Path),
    default=Path("data/edid.duckdb"),
    help="Output DuckDB database path",
)
@click.option(
    "--batch-size",
    type=int,
    default=1000,
    help="Batch size for database inserts",
)
def ingest(input_path: Path, output_path: Path, batch_size: int):
    """Ingest EDID repository into DuckDB database."""
    from .ingest import ingest_edid_repo

    click.echo(f"Ingesting EDID files from: {input_path}")
    click.echo(f"Output database: {output_path}")

    stats = ingest_edid_repo(
        input_path,
        output_path,
        batch_size=batch_size,
        show_progress=True,
    )

    click.echo("\nIngestion complete:")
    click.echo(f"  Total files:      {stats['total_files']:,}")
    click.echo(f"  Parsed:           {stats['parsed']:,}")
    click.echo(f"  Failed:           {stats['failed']:,}")
    click.echo(f"  Invalid checksum: {stats['invalid_checksum']:,}")
    click.echo(f"  Duplicates:       {stats['duplicates']:,}")
    click.echo(f"  Unique entries:   {stats['unique']:,}")


@main.command()
@click.option(
    "--db",
    "-d",
    "db_path",
    type=click.Path(exists=True, path_type=Path),
    default=Path("data/edid.duckdb"),
    help="Input DuckDB database path",
)
@click.option(
    "--output",
    "-o",
    "output_path",
    type=click.Path(path_type=Path),
    default=Path("data"),
    help="Output directory for compact files",
)
def generate(db_path: Path, output_path: Path):
    """Generate compact binary files from DuckDB database."""
    from .generate import generate_compact_files

    click.echo(f"Reading from: {db_path}")
    click.echo(f"Output directory: {output_path}")

    stats = generate_compact_files(db_path, output_path, show_progress=True)

    click.echo("\nGeneration complete:")
    click.echo(f"  Buckets written:  {stats['buckets_written']}")
    click.echo(f"  Total entries:    {stats['total_entries']:,}")
    click.echo(f"  Total size:       {stats['total_bytes']:,} bytes")


@main.command()
@click.option(
    "--db",
    "-d",
    "db_path",
    type=click.Path(exists=True, path_type=Path),
    default=Path("data/edid.duckdb"),
    help="DuckDB database path",
)
def stats(db_path: Path):
    """Show statistics from the DuckDB database."""
    import duckdb

    conn = duckdb.connect(str(db_path), read_only=True)

    # Total count
    total = conn.execute("SELECT COUNT(*) FROM edids").fetchone()[0]
    click.echo(f"Total EDIDs: {total:,}")

    # By display type
    click.echo("\nBy display type:")
    for row in conn.execute(
        "SELECT display_type, COUNT(*) FROM edids GROUP BY display_type ORDER BY 2 DESC"
    ).fetchall():
        click.echo(f"  {row[0] or 'unknown'}: {row[1]:,}")

    # Top vendors
    click.echo("\nTop 10 vendors:")
    for row in conn.execute(
        "SELECT vendor, COUNT(*) FROM edids GROUP BY vendor ORDER BY 2 DESC LIMIT 10"
    ).fetchall():
        click.echo(f"  {row[0] or 'unknown'}: {row[1]:,}")

    # Top resolutions
    click.echo("\nTop 10 resolutions:")
    for row in conn.execute("""
        SELECT width_px || 'x' || height_px as res, COUNT(*)
        FROM edids
        WHERE width_px IS NOT NULL
        GROUP BY res ORDER BY 2 DESC LIMIT 10
    """).fetchall():
        click.echo(f"  {row[0]}: {row[1]:,}")

    # Year range
    result = conn.execute("""
        SELECT MIN(manufacture_year), MAX(manufacture_year)
        FROM edids WHERE manufacture_year IS NOT NULL
    """).fetchone()
    if result:
        click.echo(f"\nManufacture years: {result[0]} - {result[1]}")

    conn.close()


if __name__ == "__main__":
    main()
