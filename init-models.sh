#!/usr/bin/env bash
# Pull required Ollama models for Universal TTRPG.
# Usage: ./init-models.sh [OLLAMA_URL]
# Default OLLAMA_URL: http://localhost:11434

set -euo pipefail

OLLAMA_URL="${1:-http://localhost:11434}"

# Core DM model (the one the crew uses for narration/rules/combat/NPC)
DM_MODEL="llama3.2"
# Alternative smaller/faster DM model: qwen2.5:7b

# Embedding model for hybrid recall (Lorekeeper semantic search)
EMBED_MODEL="nomic-embed-text"

echo "Pulling models from $OLLAMA_URL..."
echo "  DM model:       $DM_MODEL"
echo "  Embedding model: $EMBED_MODEL"

pull_model() {
    local model="$1"
    echo ">>> ollama pull $model"
    if ollama pull "$model" 2>&1 | grep -q "already exists"; then
        echo "  ✓ $model already present"
    else
        echo "  ✓ $model pulled"
    fi
}

pull_model "$DM_MODEL"
pull_model "$EMBED_MODEL"

echo ""
echo "All models ready. Verify with:"
echo "  ollama list"