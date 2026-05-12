#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_NAME="doc_processor_supervisor"
REGION="us-east-1"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────

check_prerequisites() {
    info "Checking prerequisites..."

    command -v aws >/dev/null 2>&1 || error "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
    command -v agentcore >/dev/null 2>&1 || error "agentcore CLI not found. Install: pip install bedrock-agentcore"

    # Verify AWS credentials
    if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
        error "AWS credentials not configured or expired. Run: aws sso login"
    fi

    local identity
    identity=$(aws sts get-caller-identity --region "$REGION" --output json)
    info "AWS Account: $(echo "$identity" | python3 -c "import sys,json; print(json.load(sys.stdin)['Account'])")"
    info "AWS Identity: $(echo "$identity" | python3 -c "import sys,json; print(json.load(sys.stdin)['Arn'])")"
}

# ── Deploy ───────────────────────────────────────────────────────────────────

deploy_cloud() {
    info "Deploying ${AGENT_NAME} to Bedrock AgentCore (cloud build)..."
    info "This uses CodeBuild to build the ARM64 container in the cloud."
    echo ""
    cd "$SCRIPT_DIR"
    agentcore deploy --agent "$AGENT_NAME" --auto-update-on-conflict
}

deploy_local_build() {
    info "Deploying ${AGENT_NAME} to Bedrock AgentCore (local build)..."
    info "Building container locally, then deploying to cloud."
    echo ""

    command -v docker >/dev/null 2>&1 || error "Docker not found. Required for --local-build mode."

    cd "$SCRIPT_DIR"
    agentcore deploy --agent "$AGENT_NAME" --local-build --auto-update-on-conflict
}

deploy_local() {
    info "Running ${AGENT_NAME} locally..."
    info "Building and running container on localhost:8080."
    echo ""

    command -v docker >/dev/null 2>&1 || error "Docker not found. Required for --local mode."

    cd "$SCRIPT_DIR"
    agentcore deploy --agent "$AGENT_NAME" --local
}

# ── Usage ────────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") [command]

Commands:
  cloud        Deploy to AgentCore via cloud build (default, recommended)
  local-build  Build container locally, deploy to AgentCore
  local        Build and run container locally (dev/test)
  status       Show current agent status

Examples:
  ./deploy.sh              # Cloud build + deploy (recommended)
  ./deploy.sh local        # Run locally for testing
  ./deploy.sh local-build  # Local Docker build + cloud deploy
  ./deploy.sh status       # Check agent status
EOF
}

show_status() {
    info "Checking agent status..."
    agentcore status --agent "$AGENT_NAME" 2>&1 || warn "Could not retrieve status. Agent may not be deployed yet."
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    local cmd="${1:-cloud}"

    check_prerequisites

    case "$cmd" in
        cloud)       deploy_cloud ;;
        local-build) deploy_local_build ;;
        local)       deploy_local ;;
        status)      show_status ;;
        -h|--help)   usage ;;
        *)           error "Unknown command: $cmd. Run with --help for usage." ;;
    esac
}

main "$@"
