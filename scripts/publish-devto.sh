#!/usr/bin/env bash
#
# publish-devto.sh — Publish or update the dev.to post for ngLens
#
# Usage:
#   ./scripts/publish-devto.sh              # Create as draft
#   ./scripts/publish-devto.sh --publish    # Create and publish immediately
#   ./scripts/publish-devto.sh --update ID  # Update existing article by ID
#
# Prerequisites:
#   1. Get your API key from https://dev.to/settings/extensions
#   2. Set it: export DEVTO_API_KEY="your_key_here"
#      Or add to .env: DEVTO_API_KEY=your_key_here
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
POST_FILE="$PROJECT_ROOT/dev-to-post.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load .env if exists
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  export $(grep -v '^#' "$PROJECT_ROOT/.env" | grep DEVTO_API_KEY | xargs 2>/dev/null) || true
fi

# Check API key
if [[ -z "${DEVTO_API_KEY:-}" ]]; then
  echo -e "${RED}Error: DEVTO_API_KEY not set.${NC}"
  echo ""
  echo "Get your API key from: https://dev.to/settings/extensions"
  echo ""
  echo "Then either:"
  echo "  export DEVTO_API_KEY=\"your_key_here\""
  echo "  or add to .env: DEVTO_API_KEY=your_key_here"
  exit 1
fi

# Check post file exists
if [[ ! -f "$POST_FILE" ]]; then
  echo -e "${RED}Error: dev-to-post.md not found at $POST_FILE${NC}"
  exit 1
fi

# Parse arguments
PUBLISH=false
UPDATE_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --publish)
      PUBLISH=true
      shift
      ;;
    --update)
      UPDATE_ID="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage:"
      echo "  ./scripts/publish-devto.sh              # Create as draft"
      echo "  ./scripts/publish-devto.sh --publish    # Create and publish"
      echo "  ./scripts/publish-devto.sh --update ID  # Update existing article"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Parse frontmatter and body from markdown
parse_post() {
  local file="$1"
  local in_frontmatter=false
  local frontmatter_done=false
  
  TITLE=""
  DESCRIPTION=""
  TAGS=""
  COVER_IMAGE=""
  CANONICAL_URL=""
  SERIES=""
  BODY=""

  while IFS= read -r line; do
    if [[ "$line" == "---" && "$frontmatter_done" == false ]]; then
      if [[ "$in_frontmatter" == false ]]; then
        in_frontmatter=true
        continue
      else
        in_frontmatter=false
        frontmatter_done=true
        continue
      fi
    fi

    if [[ "$in_frontmatter" == true ]]; then
      case "$line" in
        title:*) TITLE="$(echo "$line" | sed 's/^title: *"*//;s/"*$//')" ;;
        description:*) DESCRIPTION="$(echo "$line" | sed 's/^description: *"*//;s/"*$//')" ;;
        tags:*) TAGS="$(echo "$line" | sed 's/^tags: *//')" ;;
        cover_image:*) COVER_IMAGE="$(echo "$line" | sed 's/^cover_image: *//')" ;;
        canonical_url:*) CANONICAL_URL="$(echo "$line" | sed 's/^canonical_url: *//')" ;;
        series:*) SERIES="$(echo "$line" | sed 's/^series: *//')" ;;
      esac
    else
      BODY+="$line"$'\n'
    fi
  done < "$file"
}

echo -e "${CYAN}Parsing dev-to-post.md...${NC}"
parse_post "$POST_FILE"

echo -e "  Title: ${GREEN}$TITLE${NC}"
echo -e "  Tags:  ${GREEN}$TAGS${NC}"
echo -e "  Cover: ${GREEN}${COVER_IMAGE:-none}${NC}"

# Build JSON payload
build_json() {
  local published="false"
  if [[ "$PUBLISH" == true ]]; then
    published="true"
  fi

  # Use python for safe JSON encoding (handles special chars in body)
  python3 -c "
import json, sys

published = True if sys.argv[7] == 'true' else False

article = {
    'title': sys.argv[1],
    'published': published,
    'body_markdown': sys.stdin.read(),
    'tags': [t.strip() for t in sys.argv[2].split(',')],
}

cover = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else ''
if cover:
    article['cover_image'] = cover

description = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else ''
if description:
    article['description'] = description

canonical = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else ''
if canonical:
    article['canonical_url'] = canonical

series = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else ''
if series:
    article['series'] = series

print(json.dumps({'article': article}))
" "$TITLE" "$TAGS" "$COVER_IMAGE" "$DESCRIPTION" "$CANONICAL_URL" "$SERIES" "$published" <<< "$BODY"
}

JSON_PAYLOAD=$(build_json)

# Make API call
if [[ -n "$UPDATE_ID" ]]; then
  echo -e "${YELLOW}Updating article ID: $UPDATE_ID...${NC}"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X PUT \
    -H "Content-Type: application/json" \
    -H "api-key: $DEVTO_API_KEY" \
    -d "$JSON_PAYLOAD" \
    "https://dev.to/api/articles/$UPDATE_ID")
else
  echo -e "${YELLOW}Creating new article...${NC}"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "api-key: $DEVTO_API_KEY" \
    -d "$JSON_PAYLOAD" \
    "https://dev.to/api/articles")
fi

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" =~ ^2 ]]; then
  ARTICLE_ID=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  ARTICLE_URL=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
  
  echo ""
  echo -e "${GREEN}Success!${NC}"
  echo -e "  ID:  ${CYAN}$ARTICLE_ID${NC}"
  echo -e "  URL: ${CYAN}$ARTICLE_URL${NC}"
  
  if [[ "$PUBLISH" == true ]]; then
    echo -e "  Status: ${GREEN}PUBLISHED${NC}"
  else
    echo -e "  Status: ${YELLOW}DRAFT${NC} (use --publish to go live, or publish from dev.to dashboard)"
  fi
  
  # Save article ID for future updates
  echo "$ARTICLE_ID" > "$PROJECT_ROOT/.devto-article-id"
  echo -e "\n  Article ID saved to .devto-article-id (use with --update)"
else
  echo ""
  echo -e "${RED}Failed! HTTP $HTTP_CODE${NC}"
  echo "$RESPONSE_BODY" | python3 -c "
import json,sys
try:
    data = json.load(sys.stdin)
    print(f\"  Error: {data.get('error', data)}\")
except:
    print(sys.stdin.read())
" 2>/dev/null || echo "$RESPONSE_BODY"
  exit 1
fi
