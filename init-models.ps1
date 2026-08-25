# Pull required Ollama models for Universal TTRPG (PowerShell).
# Usage: ./init-models.ps1
# Exit code is non-zero if any pull fails (network, disk, unknown model).

$ErrorActionPreference = "Continue"

$Models = @("llama3.2", "nomic-embed-text")
$failures = 0

foreach ($model in $Models) {
    Write-Host ">>> ollama pull $model"
    $output = ollama pull $model 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  x $model pull FAILED (exit $LASTEXITCODE):" -ForegroundColor Red
        $output | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }
        $failures++
        continue
    }
    # Ollama streams progress; the last line tells fresh pulls from no-ops.
    $tail = ($output | Select-Object -Last 1)
    Write-Host "  OK $model: $tail" -ForegroundColor Green
}

if ($failures -gt 0) {
    Write-Host ""
    Write-Host "$failures model pull(s) failed. Check that the Ollama server is running." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All models ready. Verify with:"
Write-Host "  ollama list"
