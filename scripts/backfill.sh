#!/usr/bin/env bash
#
# Backfill DuckLake with historical versions from upstream EDID repo
#
# Iterates through commits (oldest to newest) and runs ingest for each,
# creating DuckLake versions with time-travel capability.
#
# Usage:
#   ./scripts/backfill.sh [OPTIONS]
#
# Options:
#   --since DATE     Start from commits after this date (default: 2020-01-01)
#   --interval N     Process every Nth commit (default: 1 = all commits)
#   --monthly        Only process one commit per month (overrides --interval)
#   --dry-run        Show commits that would be processed, don't ingest
#   --limit N        Process at most N commits
#   -h, --help       Show this help message
#
# Examples:
#   ./scripts/backfill.sh --monthly --since 2023-01-01
#   ./scripts/backfill.sh --interval 10 --limit 20
#   ./scripts/backfill.sh --dry-run --monthly
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EDID_DIR="$ROOT_DIR/upstream/EDID"

# Default options
SINCE_DATE="2020-01-01"
INTERVAL=1
MONTHLY=false
DRY_RUN=false
LIMIT=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

die() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
info() { echo -e "${BLUE}$1${NC}"; }
success() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }

usage() {
    head -n 24 "$0" | tail -n 21 | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --since)
            SINCE_DATE="$2"
            shift 2
            ;;
        --interval)
            INTERVAL="$2"
            shift 2
            ;;
        --monthly)
            MONTHLY=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            die "Unknown option: $1"
            ;;
    esac
done

# Check prerequisites
cd "$ROOT_DIR"

if [[ ! -d "$EDID_DIR/.git" ]] && [[ ! -f "$EDID_DIR/.git" ]]; then
    die "upstream/EDID submodule not found. Run: git submodule update --init"
fi

# Get list of commits (oldest first)
info "Fetching commit history since $SINCE_DATE..."
cd "$EDID_DIR"
git fetch origin 2>/dev/null || true

if [[ "$MONTHLY" == "true" ]]; then
    # Get one commit per month
    COMMITS=$(git log origin/master --since="$SINCE_DATE" --format="%H %ad" --date=short --reverse | \
        awk '{
            month = substr($2, 1, 7)  # YYYY-MM
            if (month != last_month) {
                print $1, $2
                last_month = month
            }
        }')
else
    # Get commits at specified interval
    COMMITS=$(git log origin/master --since="$SINCE_DATE" --format="%H %ad" --date=short --reverse | \
        awk -v interval="$INTERVAL" 'NR % interval == 1 { print $1, $2 }')
fi

cd "$ROOT_DIR"

# Count commits
TOTAL=$(echo "$COMMITS" | grep -c . || echo 0)
if [[ "$LIMIT" -gt 0 ]] && [[ "$TOTAL" -gt "$LIMIT" ]]; then
    COMMITS=$(echo "$COMMITS" | head -n "$LIMIT")
    TOTAL=$LIMIT
fi

info "Found $TOTAL commits to process"

if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "Commits that would be processed:"
    echo "$COMMITS" | while read -r hash date; do
        echo "  $date  ${hash:0:12}"
    done
    exit 0
fi

if [[ "$TOTAL" -eq 0 ]]; then
    warn "No commits to process"
    exit 0
fi

# Process each commit
COUNT=0
echo "$COMMITS" | while read -r COMMIT DATE; do
    COUNT=$((COUNT + 1))
    COMMIT_SHORT="${COMMIT:0:12}"

    echo ""
    echo "========================================"
    info "[$COUNT/$TOTAL] Processing $COMMIT_SHORT ($DATE)"
    echo "========================================"

    # Checkout the commit
    cd "$EDID_DIR"
    git checkout "$COMMIT" 2>/dev/null
    cd "$ROOT_DIR"

    # Run ingest with the commit's date as build_date
    # This creates version like: 2023.06.15-abc123def456
    uv run python -c "
import sys
sys.path.insert(0, 'src')
from edid_build.ingest import ingest_edid_repo
from pathlib import Path

ingest_edid_repo(
    repo_path=Path('upstream/EDID'),
    db_path=Path('data/ducklake/edid.ducklake'),
    build_date='$DATE',
)
"

    success "Completed $COMMIT_SHORT ($DATE)"
done

# Return submodule to original state
cd "$EDID_DIR"
git checkout - 2>/dev/null || git checkout origin/master 2>/dev/null
cd "$ROOT_DIR"

echo ""
echo "========================================"
success "Backfill complete! Processed $TOTAL versions."
echo "========================================"
echo ""
echo "View versions with:"
echo "  uv run edid-build version"
echo "  cat data/ducklake/versions.json"
echo ""
echo "Query historical data with DuckLake time-travel:"
echo "  SELECT * FROM ducklake_snapshots('edid');"
echo "  SELECT COUNT(*) FROM edid.edids AT VERSION 1;"
