#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   cp deploy.config.template.json deploy.config.json && edit values
#   clasp login   # once, manually
#   ./scripts/deploy.sh --push [--deploy]
# Reads deploy.config.json (fallback: deploy.config.template.json) to generate:
#   - .clasp.json  (scriptId, rootDir)
#   - google-app/config.generated.js (spreadsheetId, sheets, folder, slack channelIds)
# Then runs `clasp push`. With --deploy, also runs `clasp version` + `clasp deploy`.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLASP_JSON="$REPO_ROOT/.clasp.json"
CONFIG_JSON="$REPO_ROOT/deploy.config.json"
CONFIG_TEMPLATE_JSON="$REPO_ROOT/deploy.config.template.json"

DO_DEPLOY=""
DEPLOY_ID=""
FORCE_NEW_VERSION=""

extract_id() {
  local input="$1"
  if [[ -z "$input" ]]; then
    echo ""
    return
  fi
  if [[ "$input" =~ spreadsheets/d/([A-Za-z0-9_-]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$input" =~ script\.google\.com/(u/[0-9]+/)?(macros/s|d|home/projects)/([A-Za-z0-9_-]+) ]]; then
    echo "${BASH_REMATCH[3]}"
    return
  fi
  echo "$input"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy)
      DO_DEPLOY="yes"
      shift
      ;;
    --deploy-id)
      DEPLOY_ID="${2:-}"
      shift 2
      ;;
    --deploy-id=*)
      DEPLOY_ID="${1#*=}"
      shift
      ;;
    --new-version)
      FORCE_NEW_VERSION="yes"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -f "$CONFIG_JSON" ]]; then
  CONFIG_FILE="$CONFIG_JSON"
elif [[ -f "$CONFIG_TEMPLATE_JSON" ]]; then
  CONFIG_FILE="$CONFIG_TEMPLATE_JSON"
else
  echo "deploy.config.json not found (nor template). Abort." >&2
  exit 1
fi

echo "Using config: $CONFIG_FILE"

read_vars () {
python3 - "$1" <<'PY'
import json, pathlib
from sys import argv
cfg = json.load(open(argv[1]))
def out(key, default=""):
    v = cfg.get(key, default)
    if isinstance(v, list):
        v = ",".join(v)
    print(v)
out("scriptId")
out("rootDir", "google-app")
out("spreadsheetId")
out("articlesSheetName", "Articles")
out("slackSheetName", "SlackMessages")
out("driveImagesFolder", "notehub-images")
out("slackBotToken", "")
out("slackChannelIds", "")
out("slackNotificationChannelIds", "")
out("webAppUrl", "")
PY
}

CFG_OUTPUT="$(read_vars "$CONFIG_FILE")"
CFG_LINES=()
while IFS= read -r line; do
  CFG_LINES+=("$line")
done <<<"$CFG_OUTPUT"

SCRIPT_ID="${CFG_LINES[0]:-}"
ROOT_DIR="${CFG_LINES[1]:-google-app}"
SPREADSHEET_ID="${CFG_LINES[2]:-}"
ARTICLES_SHEET="${CFG_LINES[3]:-Articles}"
SLACK_SHEET="${CFG_LINES[4]:-SlackMessages}"
DRIVE_FOLDER="${CFG_LINES[5]:-notehub-images}"
SLACK_TOKEN="${CFG_LINES[6]:-}"
SLACK_CHANNEL_IDS="${CFG_LINES[7]:-}"
SLACK_NOTIFY_CHANNEL_IDS="${CFG_LINES[8]:-}"
WEB_APP_URL="${CFG_LINES[9]:-}"

SCRIPT_ID="$(extract_id "$SCRIPT_ID")"
SPREADSHEET_ID="$(extract_id "$SPREADSHEET_ID")"

if [[ -z "$SCRIPT_ID" ]]; then
  echo "scriptId is empty in $CONFIG_FILE" >&2
  exit 1
fi

cat > "$CLASP_JSON" <<EOF
{
  "scriptId": "$SCRIPT_ID",
  "rootDir": "$ROOT_DIR"
}
EOF
echo "Wrote $CLASP_JSON"

python3 - <<PY
import json, pathlib
generated = {
  "spreadsheetId": "$SPREADSHEET_ID",
  "sheets": {"articles": "$ARTICLES_SHEET", "slackMessages": "$SLACK_SHEET"},
  "drive": {"imagesFolderName": "$DRIVE_FOLDER"},
  "slack": {
    "botToken": "$SLACK_TOKEN",
    "channelIds": "$SLACK_CHANNEL_IDS",
    "notificationChannelIds": "$SLACK_NOTIFY_CHANNEL_IDS",
    "botTokenPropertyKey": "SLACK_BOT_TOKEN",
    "channelIdsPropertyKey": "SLACK_CHANNEL_IDS",
    "notificationChannelIdsPropertyKey": "SLACK_NOTIFY_CHANNEL_IDS"
  },
  "webAppUrl": "$WEB_APP_URL"
}
path = pathlib.Path("$ROOT_DIR/config.generated.js")
path.write_text("const GENERATED_CONFIG = " + json.dumps(generated, ensure_ascii=False, indent=2) + ";\n")
print(f"Wrote {path}")
PY

echo "Running clasp push..."
(cd "$REPO_ROOT/$ROOT_DIR" && clasp push)

if [[ -n "$DO_DEPLOY" ]]; then
  if [[ -z "$DEPLOY_ID" && -z "$FORCE_NEW_VERSION" ]]; then
    # 既存デプロイを自動検出（HEADを除き、@番号が最大のものを選ぶ）。見つからなければ新規。
    DEPLOY_OUT="$(cd "$REPO_ROOT/$ROOT_DIR" && clasp deployments)"
    DEPLOY_ID="$(echo "$DEPLOY_OUT" \
      | awk '/^- AKfy/ && $0 !~ /@HEAD/ {print $2, $3}' \
      | sed 's/@//' \
      | sort -k2,2nr \
      | head -n1 \
      | awk '{print $1}')"
    if [[ -z "$DEPLOY_ID" ]]; then
      FORCE_NEW_VERSION="yes"
    fi
  fi

  echo "Running clasp version+deploy..."
  VERSION_NUMBER=""
  if [[ -n "$FORCE_NEW_VERSION" || -z "$DEPLOY_ID" ]]; then
    VERSION_OUT="$(cd "$REPO_ROOT/$ROOT_DIR" && clasp version "auto deploy")"
    echo "$VERSION_OUT"
    VERSION_NUMBER="$(echo "$VERSION_OUT" | awk '/Created version/{print $3}' | tail -n1)"
    if [[ -z "$VERSION_NUMBER" ]]; then
      echo "Failed to parse version number from clasp version output" >&2
      exit 1
    fi
  fi
  DEPLOYED_ID=""
  DEPLOY_OUTPUT=""

  # Try updating existing deployment first (auto-detected or specified)
  if [[ -n "$DEPLOY_ID" ]]; then
    VERSION_ARG=""
    if [[ -n "$VERSION_NUMBER" ]]; then
      VERSION_ARG="--versionNumber $VERSION_NUMBER"
    fi
    set +e
    DEPLOY_OUTPUT=$(cd "$REPO_ROOT/$ROOT_DIR" && clasp deploy --deploymentId "$DEPLOY_ID" $VERSION_ARG --description "script deploy" 2>&1)
    DEPLOY_STATUS=$?
    set -e
    if [[ $DEPLOY_STATUS -eq 0 && "$DEPLOY_OUTPUT" != *"Read-only deployments may not be modified."* ]]; then
      DEPLOYED_ID="$DEPLOY_ID"
    else
      echo "Existing deployment is read-only or failed; creating new deployment..." >&2
      DEPLOY_ID=""
      DEPLOYED_ID=""
      DEPLOY_OUTPUT=""
      VERSION_NUMBER=""          # force creating a fresh version
      FORCE_NEW_VERSION="yes"     # ensure version is bumped
    fi
  fi

  # Fallback: create a new deployment (ensure a version exists)
  if [[ -z "$DEPLOYED_ID" ]]; then
    echo "Fallback: creating new deployment..."
    VERSION_ARG=""
    if [[ -z "$VERSION_NUMBER" ]]; then
      VERSION_OUT="$(cd "$REPO_ROOT/$ROOT_DIR" && clasp version "auto deploy")"
      echo "$VERSION_OUT"
      VERSION_NUMBER="$(echo "$VERSION_OUT" | awk '/Created version/{print $3}' | tail -n1)"
    fi
    if [[ -n "$VERSION_NUMBER" ]]; then
      VERSION_ARG="--versionNumber $VERSION_NUMBER"
    fi
    set +e
    DEPLOY_OUTPUT=$(cd "$REPO_ROOT/$ROOT_DIR" && clasp deploy $VERSION_ARG --description "script deploy" 2>&1)
    DEPLOY_STATUS=$?
    set -e
    if [[ $DEPLOY_STATUS -ne 0 ]]; then
      echo "Deploy failed." >&2
      echo "$DEPLOY_OUTPUT" >&2
      exit 1
    fi
    DEPLOYED_ID="$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*Deployed \(AKfy[^ ]*\).*/\1/p' | head -n1)"
  fi
  echo "$DEPLOY_OUTPUT"
  # デプロイ一覧から最新の WebApp URL を表示（あれば）
  echo "Fetching deployment URLs..."
  DEPLOY_INFO="$(cd "$REPO_ROOT/$ROOT_DIR" && clasp deployments || true)"
  echo "$DEPLOY_INFO"
  if [[ -n "$DEPLOYED_ID" ]]; then
    echo "Web App URL          : https://script.google.com/macros/s/$DEPLOYED_ID/exec"
    echo "Web App (dev) URL    : https://script.google.com/macros/s/$DEPLOYED_ID/dev"
  fi

  # 古いデプロイを整理（HEAD と最新のみ残す）
  if [[ -n "$DEPLOYED_ID" ]]; then
    echo "Cleaning up old deployments (keeping HEAD and $DEPLOYED_ID)..."
    # 最新以外の非HEADを削除
    CLEAN_LIST="$(echo "$DEPLOY_INFO" | awk '/^- AKfy/ && $0 !~ /@HEAD/ {print $2, $3}' | sed 's/@//' | sort -k2,2nr | tail -n +2 | awk '{print $1}')"
    for del_id in $CLEAN_LIST; do
      if [[ "$del_id" == "$DEPLOYED_ID" ]]; then
        continue
      fi
      echo "  undeploy $del_id"
      (cd "$REPO_ROOT/$ROOT_DIR" && clasp undeploy "$del_id" || true)
    done
  fi
  echo "If this was the first deploy, open GAS editor and run ensureSheetStructure once to grant permissions."
fi
