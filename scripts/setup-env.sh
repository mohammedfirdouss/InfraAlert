#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

if [[ -f "$ENV_FILE" ]]; then
    echo ".env already exists at $ENV_FILE — skipping copy."
else
    if [[ ! -f "$ENV_EXAMPLE" ]]; then
        echo "ERROR: $ENV_EXAMPLE not found. Cannot create .env."
        exit 1
    fi
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from $ENV_EXAMPLE."
fi

if command -v gcloud &>/dev/null; then
    DETECTED_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
    if [[ -n "$DETECTED_PROJECT" && "$DETECTED_PROJECT" != "(unset)" ]]; then
        echo "Detected gcloud project: $DETECTED_PROJECT"
        # Replace the placeholder value in .env (sed -i works on both GNU/BSD)
        sed -i.bak \
            "s|^GOOGLE_CLOUD_PROJECT=.*|GOOGLE_CLOUD_PROJECT=$DETECTED_PROJECT|" \
            "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
        echo "GOOGLE_CLOUD_PROJECT set to '$DETECTED_PROJECT' in .env."
    else
        echo "No active gcloud project detected — GOOGLE_CLOUD_PROJECT not auto-filled."
    fi
else
    echo "gcloud not found — GOOGLE_CLOUD_PROJECT not auto-filled."
fi

echo " Next step: open .env and fill in your actual values."
echo " Pay special attention to:"
echo "   GEMINI_API_KEY"
echo "   AFRICASTALKING_API_KEY"
echo "   GOOGLE_APPLICATION_CREDENTIALS  (if not using ADC)"
echo "Run 'make setup-tools' to install uv and configure gcloud."
