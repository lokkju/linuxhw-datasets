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
    default=Path("upstream/EDID"),
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
    default=50000,
    help="Rows per Parquet file (default: 50000)",
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


@main.command()
@click.option(
    "--data-dir",
    "-d",
    "data_dir",
    type=click.Path(exists=True, path_type=Path),
    default=Path("data"),
    help="Data directory containing versions.json",
)
def version(data_dir: Path):
    """Show current data version."""
    import json

    versions_path = data_dir / "versions.json"
    if not versions_path.exists():
        click.echo("No versions.json found. Run 'edid-build ingest' first.")
        return

    with open(versions_path) as f:
        versions = json.load(f)

    current = versions.get("current", "unknown")
    click.echo(f"Data version: {current}")

    if versions.get("versions"):
        latest = versions["versions"][0]
        click.echo(f"  Date:     {latest.get('date', 'unknown')}")
        click.echo(f"  Upstream: {latest.get('upstream', 'unknown')}")
        click.echo(f"  Count:    {latest.get('count', 0):,} EDIDs")
        click.echo(f"  Built:    {latest.get('ts', 'unknown')}")


@main.command()
@click.option(
    "--submodule",
    "-s",
    "submodule_path",
    type=click.Path(path_type=Path),
    default=Path("upstream/EDID"),
    help="Path to linuxhw/EDID submodule",
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
    "--check-only",
    is_flag=True,
    help="Only check for updates, don't apply them",
)
@click.option(
    "--force",
    "-f",
    is_flag=True,
    help="Update and ingest even if no changes detected",
)
def update(
    submodule_path: Path,
    output_path: Path,
    check_only: bool,
    force: bool,
):
    """Check for upstream updates and re-ingest if needed.

    This command:
    1. Fetches latest from linuxhw/EDID remote
    2. Compares current submodule commit to remote HEAD
    3. If updates available, updates submodule and runs ingest
    """
    import subprocess

    from .ingest import ingest_edid_repo

    if not submodule_path.exists():
        raise click.ClickException(f"Submodule path does not exist: {submodule_path}")

    # Get current commit
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=submodule_path,
        capture_output=True,
        text=True,
        check=True,
    )
    current_commit = result.stdout.strip()
    current_short = current_commit[:12]

    click.echo(f"Current commit: {current_short}")

    # Fetch latest from remote
    click.echo("Fetching from remote...")
    subprocess.run(
        ["git", "fetch", "origin"],
        cwd=submodule_path,
        capture_output=True,
        check=True,
    )

    # Get remote HEAD commit
    result = subprocess.run(
        ["git", "rev-parse", "origin/master"],
        cwd=submodule_path,
        capture_output=True,
        text=True,
        check=True,
    )
    remote_commit = result.stdout.strip()
    remote_short = remote_commit[:12]

    click.echo(f"Remote commit:  {remote_short}")

    # Check if update needed
    if current_commit == remote_commit and not force:
        click.echo("\n✓ Already up to date")
        return

    # Show what changed
    if current_commit != remote_commit:
        result = subprocess.run(
            ["git", "log", "--oneline", f"{current_commit}..{remote_commit}"],
            cwd=submodule_path,
            capture_output=True,
            text=True,
            check=True,
        )
        commit_count = len(result.stdout.strip().split("\n")) if result.stdout.strip() else 0
        click.echo(f"\n{commit_count} new commit(s) available:")
        for line in result.stdout.strip().split("\n")[:10]:
            click.echo(f"  {line}")
        if commit_count > 10:
            click.echo(f"  ... and {commit_count - 10} more")

    if check_only:
        click.echo("\n--check-only specified, not applying updates")
        return

    # Update submodule
    click.echo("\nUpdating submodule...")
    subprocess.run(
        ["git", "checkout", remote_commit],
        cwd=submodule_path,
        capture_output=True,
        check=True,
    )

    # Get commit date for display
    result = subprocess.run(
        ["git", "log", "-1", "--format=%ci"],
        cwd=submodule_path,
        capture_output=True,
        text=True,
        check=True,
    )
    commit_date = result.stdout.strip().split()[0]

    click.echo(f"Updated to: {remote_short} ({commit_date})")

    # Run ingest
    click.echo("\nRunning ingest...")
    stats = ingest_edid_repo(
        submodule_path,
        output_path,
        upstream_path=submodule_path,
        show_progress=True,
    )

    click.echo("\nUpdate complete:")
    click.echo(f"  Previous commit: {current_short}")
    click.echo(f"  New commit:      {remote_short} ({commit_date})")
    click.echo(f"  Total EDIDs:     {stats['unique']:,}")
    if "added" in stats:
        click.echo(f"  Added:           {stats['added']:,}")
        click.echo(f"  Modified:        {stats['modified']:,}")
        click.echo(f"  Deleted:         {stats['deleted']:,}")


if __name__ == "__main__":
    main()
