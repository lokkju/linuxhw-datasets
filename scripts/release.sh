#!/usr/bin/env bash
#
# Release script for linuxhw-datasets EDID dataset
#
# Updates the linuxhw/EDID submodule, rebuilds both datasets,
# creates release archives, and prints commands for push/release.
#
# Usage:
#   ./scripts/release.sh [OPTIONS]
#
# Options:
#   --check-only   Only check for updates, don't build
#   --force        Force rebuild even if no upstream changes
#   --no-commit    Skip git commit (for testing)
#   -h, --help     Show this help message
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default options
CHECK_ONLY=false
FORCE=false
NO_COMMIT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

die() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}$1${NC}"
}

success() {
    echo -e "${GREEN}$1${NC}"
}

warn() {
    echo -e "${YELLOW}$1${NC}"
}

usage() {
    head -n 17 "$0" | tail -n 14 | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --check-only)
            CHECK_ONLY=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --no-commit)
            NO_COMMIT=true
            shift
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
info "Checking prerequisites..."
for cmd in gh uv git jq; do
    if ! command -v "$cmd" &>/dev/null; then
        die "$cmd is required but not installed"
    fi
done

# Ensure we're in the right directory
cd "$ROOT_DIR"

# Check submodule exists (may be file for gitlink or directory)
if [[ ! -e "upstream/EDID/.git" ]]; then
    die "upstream/EDID submodule not found. Run: git submodule update --init"
fi

# Get current submodule commit
CURRENT=$(git -C "upstream/EDID" rev-parse HEAD)
CURRENT_SHORT="${CURRENT:0:12}"

info "Current submodule: $CURRENT_SHORT"

# Fetch latest from remote
info "Fetching from upstream..."
git -C "upstream/EDID" fetch origin 2>/dev/null

# Get remote HEAD commit
REMOTE=$(git -C "upstream/EDID" rev-parse origin/master)
REMOTE_SHORT="${REMOTE:0:12}"

info "Remote HEAD:       $REMOTE_SHORT"

# Check if update needed
if [[ "$CURRENT" == "$REMOTE" ]]; then
    if [[ "$FORCE" == "true" ]]; then
        warn "No changes but --force specified, continuing..."
    else
        success "Already up to date at $CURRENT_SHORT"
        exit 0
    fi
else
    # Show what changed
    COMMIT_COUNT=$(git -C "upstream/EDID" log --oneline "$CURRENT..$REMOTE" | wc -l)
    info "$COMMIT_COUNT new commit(s) available"
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
    if [[ "$CURRENT" != "$REMOTE" ]]; then
        echo ""
        echo "Updates available: $CURRENT_SHORT -> $REMOTE_SHORT"
        echo ""
        echo "Recent commits:"
        git -C "upstream/EDID" log --oneline "$CURRENT..$REMOTE" | head -5
    fi
    exit 0
fi

# Update submodule
info "Updating submodule to $REMOTE_SHORT..."
git -C "upstream/EDID" checkout "$REMOTE" 2>/dev/null

# Rebuild datasets
echo ""
info "Running ingest..."
uv run edid-build ingest

echo ""
info "Running generate..."
uv run edid-build generate

# Get version info from versions.json
VERSIONS_FILE="$ROOT_DIR/data/ducklake/versions.json"
if [[ ! -f "$VERSIONS_FILE" ]]; then
    die "versions.json not found at $VERSIONS_FILE"
fi

DATA_VERSION=$(jq -r '.current' "$VERSIONS_FILE")
FORMAT_VERSION=$(jq -r '.format_version // "v1"' "$VERSIONS_FILE")
COUNT=$(jq -r '.versions[0].count' "$VERSIONS_FILE")
UPSTREAM_COMMIT=$(jq -r '.versions[0].upstream_commit' "$VERSIONS_FILE")
UPSTREAM_DATE=$(jq -r '.versions[0].upstream_date' "$VERSIONS_FILE")

# Git tag uses 'v' prefix
TAG="v${DATA_VERSION}"

info "Data version:   $DATA_VERSION"
info "Format version: $FORMAT_VERSION"
info "Git tag:        $TAG"
info "Count:          $COUNT EDIDs"

# Create dist directory and archives
mkdir -p "$ROOT_DIR/dist"
DUCKLAKE_ARCHIVE="dist/linuxhw-edid-ducklake-${TAG}.tar.gz"
ROARING_ARCHIVE="dist/linuxhw-edid-roaringbuckets-${TAG}.tar.gz"

echo ""
info "Creating archives..."
tar -czf "$ROOT_DIR/$DUCKLAKE_ARCHIVE" -C "$ROOT_DIR/data" ducklake
tar -czf "$ROOT_DIR/$ROARING_ARCHIVE" -C "$ROOT_DIR/data" roaringbuckets

DUCKLAKE_SIZE=$(du -h "$ROOT_DIR/$DUCKLAKE_ARCHIVE" | cut -f1)
ROARING_SIZE=$(du -h "$ROOT_DIR/$ROARING_ARCHIVE" | cut -f1)

success "Created: $DUCKLAKE_ARCHIVE ($DUCKLAKE_SIZE)"
success "Created: $ROARING_ARCHIVE ($ROARING_SIZE)"

# Commit changes (local only)
if [[ "$NO_COMMIT" == "true" ]]; then
    warn "Skipping commit (--no-commit)"
else
    echo ""
    info "Committing changes..."
    git add upstream/EDID data/
    git commit -m "data: Update to $TAG

Upstream: $UPSTREAM_COMMIT ($UPSTREAM_DATE)
Count: $COUNT EDIDs"
    success "Committed: data: Update to $TAG"
fi

# Generate release notes
NOTES="## EDID Dataset $TAG

**$COUNT** unique EDID entries from [linuxhw/EDID](https://github.com/linuxhw/EDID).

### Version Info
- **Format:** $FORMAT_VERSION
- **Data:** $DATA_VERSION

### Upstream
- Commit: [\`$UPSTREAM_COMMIT\`](https://github.com/linuxhw/EDID/commit/$UPSTREAM_COMMIT)
- Date: $UPSTREAM_DATE

### Downloads
- **DuckLake** ($DUCKLAKE_SIZE): SQL queries via DuckDB with time-travel
- **RoaringBuckets** ($ROARING_SIZE): Compact binary for fast lookups

See [README](https://github.com/lokkju/linuxhw-datasets#readme) for usage."

# Print next steps
echo ""
echo "========================================"
success "Release prepared: $TAG"
echo "========================================"
echo ""
echo "Archives created in dist/"
echo "  - $DUCKLAKE_ARCHIVE ($DUCKLAKE_SIZE)"
echo "  - $ROARING_ARCHIVE ($ROARING_SIZE)"
echo ""
echo "To complete the release, run:"
echo ""
echo "  git push"
echo ""
cat <<EOF
  gh release create '$TAG' \\
    --title 'EDID Dataset $TAG' \\
    --notes '$NOTES' \\
    '$DUCKLAKE_ARCHIVE' \\
    '$ROARING_ARCHIVE'
EOF
