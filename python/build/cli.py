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
    default=Path("data/edid.ducklake"),
    help="Output DuckLake database path",
)
@click.option(
    "--upstream",
    "-u",
    "upstream_path",
    type=click.Path(exists=True, path_type=Path),
    default=None,
    help="Path to upstream linuxhw/EDID repo (for version tracking, defaults to --input)",
)
@click.option(
    "--workers",
    "-w",
    type=int,
    default=None,
    help="Number of parallel workers (default: CPU count)",
)
@click.option(
    "--batch-size",
    "-b",
    type=int,
    default=3000,
    help="Rows per Parquet file (~3000 ≈ 3MB, default: 3000)",
)
def ingest(
    input_path: Path,
    output_path: Path,
    upstream_path: Path | None,
    workers: int | None,
    batch_size: int,
):
    """Ingest EDID repository into DuckLake database."""
    from .ingest import ingest_edid_repo

    click.echo(f"Ingesting EDID files from: {input_path}")
    click.echo(f"Output database: {output_path}")

    stats = ingest_edid_repo(
        input_path,
        output_path,
        upstream_path=upstream_path,
        workers=workers,
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
    default=Path("data/edid.ducklake"),
    help="Input DuckLake database path",
)
@click.option(
    "--output",
    "-o",
    "output_path",
    type=click.Path(path_type=Path),
    default=Path("data"),
    help="Output directory for compact files",
)
@click.option(
    "--upstream",
    "-u",
    "upstream_path",
    type=click.Path(exists=True, path_type=Path),
    default=None,
    help="Path to upstream linuxhw/EDID repo (for rev info in manifest)",
)
def generate(db_path: Path, output_path: Path, upstream_path: Path | None):
    """Generate compact binary files from DuckLake database."""
    from .generate import generate_compact_files

    click.echo(f"Reading from: {db_path}")
    click.echo(f"Output directory: {output_path}")

    stats = generate_compact_files(
        db_path, output_path, upstream_path=upstream_path, show_progress=True
    )

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
    default=Path("data/edid.ducklake"),
    help="DuckLake database path",
)
def stats(db_path: Path):
    """Show statistics from the DuckLake database."""
    import duckdb

    conn = duckdb.connect()
    conn.execute("INSTALL ducklake")
    conn.execute("LOAD ducklake")
    conn.execute(f"ATTACH '{db_path}' AS edid (TYPE ducklake)")

    # Total count
    total = conn.execute("SELECT COUNT(*) FROM edid.edids").fetchone()[0]
    click.echo(f"Total EDIDs: {total:,}")

    # By display type
    click.echo("\nBy display type:")
    for row in conn.execute(
        "SELECT display_type, COUNT(*) FROM edid.edids GROUP BY display_type ORDER BY 2 DESC"
    ).fetchall():
        click.echo(f"  {row[0] or 'unknown'}: {row[1]:,}")

    # Top vendors
    click.echo("\nTop 10 vendors:")
    for row in conn.execute(
        "SELECT vendor, COUNT(*) FROM edid.edids GROUP BY vendor ORDER BY 2 DESC LIMIT 10"
    ).fetchall():
        click.echo(f"  {row[0] or 'unknown'}: {row[1]:,}")

    # Top resolutions
    click.echo("\nTop 10 resolutions:")
    for row in conn.execute("""
        SELECT width_px || 'x' || height_px as res, COUNT(*)
        FROM edid.edids
        WHERE width_px IS NOT NULL
        GROUP BY res ORDER BY 2 DESC LIMIT 10
    """).fetchall():
        click.echo(f"  {row[0]}: {row[1]:,}")

    # Year range
    result = conn.execute("""
        SELECT MIN(manufacture_year), MAX(manufacture_year)
        FROM edid.edids WHERE manufacture_year IS NOT NULL
    """).fetchone()
    if result:
        click.echo(f"\nManufacture years: {result[0]} - {result[1]}")

    conn.close()


if __name__ == "__main__":
    main()
