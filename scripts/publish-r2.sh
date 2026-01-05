#!/usr/bin/env bash
#
# Publish datasets to Cloudflare R2
#
# Uploads DuckLake and RoaringBuckets datasets to R2 bucket with versioned paths.
#
# URL structure: /{base_path}/{format_version}/{data_version}/
#   Versioned: /datasets/linuxhw/edid/v1/2026.01.05-cc83e52221a9/ducklake/
#   Latest:    /datasets/linuxhw/edid/v1/latest/ducklake/
#
# Usage:
#   ./scripts/publish-r2.sh [OPTIONS]
#
# Options:
#   --check          Only show what would be uploaded, don't upload
#   --no-latest      Don't update the 'latest' marker
#   -h, --help       Show this help message
#
# Environment variables (required):
#   R2_ACCOUNT_ID    Cloudflare account ID
#   R2_ACCESS_KEY_ID R2 access key ID
#   R2_SECRET_ACCESS_KEY R2 secret access key
#   R2_BUCKET        R2 bucket name (default: linuxhw-datasets)
#
# Prerequisites:
#   - rclone installed and configured
#   - R2 credentials set in environment or .env file
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default options
CHECK_ONLY=false
UPDATE_LATEST=true

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
    head -n 28 "$0" | tail -n 25 | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --no-latest)
            UPDATE_LATEST=false
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

# Load .env if exists
if [[ -f "$ROOT_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
fi

# Check prerequisites
info "Checking prerequisites..."
if ! command -v rclone &>/dev/null; then
    die "rclone is required but not installed. Install with: brew install rclone"
fi

if ! command -v jq &>/dev/null; then
    die "jq is required but not installed"
fi

# Check R2 credentials
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID environment variable is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID environment variable is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY environment variable is required}"
R2_BUCKET="${R2_BUCKET:-roaringbuckets}"
R2_BASE_PATH="${R2_BASE_PATH:-datasets/linuxhw/edid}"

# Get version info
VERSIONS_FILE="$ROOT_DIR/data/ducklake/versions.json"
if [[ ! -f "$VERSIONS_FILE" ]]; then
    die "versions.json not found. Run 'edid-build ingest' first."
fi

DATA_VERSION=$(jq -r '.current' "$VERSIONS_FILE")
FORMAT_VERSION=$(jq -r '.format_version // "v1"' "$VERSIONS_FILE")

info "Data version:   $DATA_VERSION"
info "Format version: $FORMAT_VERSION"
info "R2 bucket:      $R2_BUCKET"
info "Base path:      $R2_BASE_PATH"

# Build R2 path: {base_path}/{format_version}/{data_version}
R2_PATH="${R2_BASE_PATH}/${FORMAT_VERSION}/${DATA_VERSION}"
info "Full R2 path:   $R2_PATH"

# Configure rclone for R2 (temporary config)
RCLONE_CONFIG=$(mktemp)
trap 'rm -f "$RCLONE_CONFIG"' EXIT

cat > "$RCLONE_CONFIG" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF

# Rclone command with config
RCLONE="rclone --config=$RCLONE_CONFIG"

# Check if version already exists
if $RCLONE lsf "r2:${R2_BUCKET}/${R2_PATH}/" &>/dev/null 2>&1; then
    EXISTING=$($RCLONE lsf "r2:${R2_BUCKET}/${R2_PATH}/" 2>/dev/null | head -1)
    if [[ -n "$EXISTING" ]]; then
        warn "Version $DATA_VERSION already exists in R2"
        if [[ "$CHECK_ONLY" == "true" ]]; then
            exit 0
        fi
        read -p "Overwrite? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    fi
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
    echo ""
    info "Would upload to: r2:${R2_BUCKET}/${R2_PATH}/"
    echo ""
    DUCKLAKE_SIZE=$(du -sh "$ROOT_DIR/data/ducklake/" | cut -f1)
    ROARING_SIZE=$(du -sh "$ROOT_DIR/data/roaringbuckets/" | cut -f1)
    echo "DuckLake:       $DUCKLAKE_SIZE"
    echo "RoaringBuckets: $ROARING_SIZE"
    echo ""
    echo "Total: $(du -shc "$ROOT_DIR/data/ducklake/" "$ROOT_DIR/data/roaringbuckets/" 2>/dev/null | grep total | cut -f1)"
    exit 0
fi

# Upload DuckLake to versioned path
echo ""
info "Uploading DuckLake to versioned path..."
$RCLONE sync "$ROOT_DIR/data/ducklake/" "r2:${R2_BUCKET}/${R2_PATH}/ducklake/" \
    --progress \
    --transfers 4

# Upload RoaringBuckets to versioned path
echo ""
info "Uploading RoaringBuckets to versioned path..."
$RCLONE sync "$ROOT_DIR/data/roaringbuckets/" "r2:${R2_BUCKET}/${R2_PATH}/roaringbuckets/" \
    --progress \
    --transfers 4

# Also upload to 'latest' path
LATEST_PATH="${R2_BASE_PATH}/${FORMAT_VERSION}/latest"
if [[ "$UPDATE_LATEST" == "true" ]]; then
    echo ""
    info "Uploading DuckLake to latest path..."
    $RCLONE sync "$ROOT_DIR/data/ducklake/" "r2:${R2_BUCKET}/${LATEST_PATH}/ducklake/" \
        --progress \
        --transfers 4

    echo ""
    info "Uploading RoaringBuckets to latest path..."
    $RCLONE sync "$ROOT_DIR/data/roaringbuckets/" "r2:${R2_BUCKET}/${LATEST_PATH}/roaringbuckets/" \
        --progress \
        --transfers 4

    success "Updated latest -> $DATA_VERSION"
fi

# Purge Cloudflare cache (for worker-generated pages)
if [[ -n "${CF_ZONE_ID:-}" ]] && [[ -n "${CF_API_TOKEN:-}" ]]; then
    echo ""
    info "Purging Cloudflare cache..."

    # Purge directory listings and latest paths
    BASE_URL="${R2_PUBLIC_URL%/}/${R2_BASE_PATH}"
    PURGE_PREFIXES="[
        \"${BASE_URL}/\",
        \"${BASE_URL}/${FORMAT_VERSION}/\",
        \"${BASE_URL}/${FORMAT_VERSION}/latest/\"
    ]"

    PURGE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"prefixes\":${PURGE_PREFIXES}}")

    if echo "$PURGE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Cache purged for dataset paths"
    else
        warn "Cache purge failed: $(echo "$PURGE_RESPONSE" | jq -r '.errors[0].message // "unknown error"')"
    fi
else
    warn "Skipping cache purge (CF_ZONE_ID or CF_API_TOKEN not set)"
fi

# Summary
echo ""
echo "========================================"
success "Published to R2: $R2_PATH"
echo "========================================"
echo ""
echo "Files uploaded:"
$RCLONE ls "r2:${R2_BUCKET}/${R2_PATH}/" 2>/dev/null | head -20
echo ""

# Print public URL if R2_PUBLIC_URL is set
if [[ -n "${R2_PUBLIC_URL:-}" ]]; then
    echo "Public URLs (versioned):"
    echo "  DuckLake:       ${R2_PUBLIC_URL}/${R2_PATH}/ducklake/"
    echo "  RoaringBuckets: ${R2_PUBLIC_URL}/${R2_PATH}/roaringbuckets/"
    if [[ "$UPDATE_LATEST" == "true" ]]; then
        echo ""
        echo "Public URLs (latest):"
        echo "  DuckLake:       ${R2_PUBLIC_URL}/${LATEST_PATH}/ducklake/"
        echo "  RoaringBuckets: ${R2_PUBLIC_URL}/${LATEST_PATH}/roaringbuckets/"
    fi
fi
