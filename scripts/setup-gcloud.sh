#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud &>/dev/null; then
    echo "gcloud CLI is not installed."
    echo ""
    echo "Install it by following the instructions at:"
    echo "  https://cloud.google.com/sdk/docs/install"
    echo ""
    echo "After installation, re-run this script."
    exit 1
fi

echo "gcloud CLI found: $(gcloud --version | head -1)"

echo ""
echo "==> Setting up Application Default Credentials …"
gcloud auth application-default login

TARGET_PROJECT="${PROJECT_ID:-your-project-id}"

if [[ "$TARGET_PROJECT" == "your-project-id" ]]; then
    echo ""
    echo "WARNING: PROJECT_ID is not set in the environment."
    echo "Skipping 'gcloud config set project'."
    echo "Set PROJECT_ID before running this script, or run:"
    echo "  gcloud config set project <your-actual-project-id>"
else
    echo ""
    echo "==> Setting active project to '$TARGET_PROJECT' …"
    gcloud config set project "$TARGET_PROJECT"
    echo "Active project set to: $TARGET_PROJECT"
fi

echo ""
echo "gcloud setup complete."
