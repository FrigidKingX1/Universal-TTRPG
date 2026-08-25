#!/usr/bin/env pwsh
# Pull required Ollama models for Universal TTRPG (PowerShell).
# Usage: ./init-models.ps1 [[-OllamaUrl] <string>]
# Default OllamaUrl: http://localhost:11434

param(
    [string]$OllamaUrl = "http://localhost:11434"
)

$ErrorActionPreference = "Stop"

$DmModel = "llama3.2"
$EmbedModel = "nomic-embed-text"

Write-Host "Pulling models from $OllamaUrl..."
Write-Host "  DM model:       $DmModel"
Write-Host "  Embedding model: $EmbedModel"

function Pull-Model($model) {
    Write-Host ">>> ollama pull $model"
    $output = ollama pull $model 2>&1
    if ($output -match "already exists") {
        Write-Host "  ✓ $model already present" -ForegroundColor Green
    } else {
        Write-Host "  ✓ $model pulled" -ForegroundColor Green
    }
}

Pull-Model $DmModel
Pull-Model $EmbedModel

Write-Host ""
Write-Host "All models ready. Verify with:"
Write-Host "  ollama list"