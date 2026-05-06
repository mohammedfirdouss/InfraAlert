#!/usr/bin/env bash
set -euo pipefail

if command -v uv &>/dev/null; then
    echo "uv is already installed: $(uv --version)"
else
    echo "uv not found — installing via the official installer …"
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Add uv to PATH for the rest of this script session (the installer places
    # the binary in ~/.cargo/bin or ~/.local/bin depending on the platform).
    export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

    if command -v uv &>/dev/null; then
        echo "uv installed successfully: $(uv --version)"
    else
        echo "ERROR: uv installation appeared to succeed but 'uv' is not on PATH."
        echo "Please open a new shell or add the install directory to your PATH."
        exit 1
    fi
fi
