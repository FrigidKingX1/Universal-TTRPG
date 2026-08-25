#!/usr/bin/env bash
# Pull required Ollama models for Universal TTRPG.
# Usage: ./init-models.sh
# Exit code is non-zero if any pull fails (network, disk, unknown model).

set -u

DM_MODEL="llama3.2"
EMBED_MODEL="nomic-embed-text"

failures=0

pull_model() {
    local model="$1"
    echo ">>> ollama pull $model"
    local output status
    output="$(ollama pull "$model" 2>&1)"
    status=$?
    if [ $status -ne 0 ]; then
        echo "  ✗ $model pull FAILED (exit $status):"
        echo "$output" | tail -n 5 | sed 's/^/    /'
        failures=$((failures + 1))
        return
    fi
    # Ollama streams progress; the tail tells fresh pulls from no-ops.
    echo "  ✓ $model: $(echo "$output" | tail -n 1)"
}

pull_model "$DM_MODEL"
pull_model "$EMBED_MODEL"

if [ $failures -gt 0 ]; then
    echo ""
    echo "$failures model pull(s) failed. Check that the Ollama server is running."
    exit 1
fi

echo ""
echo "All models ready. Verify with:"
echo "  ollama list"
