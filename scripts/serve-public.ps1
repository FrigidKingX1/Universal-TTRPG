# serve-public.ps1 — start the multiplayer server + a Cloudflare quick tunnel.
# Usage: ./scripts/serve-public.ps1 [[-DataDir] <string>] [[-Port] <int>]
# Requires: cargo (rustup), cloudflared on PATH for remote reachability.
# See docs/HOSTING.md for named-tunnel (stable URL) setup.

param(
    [string]$DataDir = "sessions",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

# ── Locate cloudflared (optional — server still runs without it) ────
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Write-Warning "cloudflared not found on PATH — LAN-only mode."
    Write-Warning "Install with: winget install --id Cloudflare.cloudflared"
}

# ── Build the server binary if missing ──────────────────────────────
$exe = Join-Path $PSScriptRoot "..\target\release\auto-dm-server.exe"
if (-not (Test-Path $exe)) {
    Write-Host "Release binary missing — building (first run only)…"
    cargo build --release -p auto-dm-server
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
}

# ── Start the Axum server ───────────────────────────────────────────
$env:ADDR = "0.0.0.0:$Port"
Write-Host "Starting auto-dm-server on 0.0.0.0:$Port (data: $DataDir)"
$server = Start-Process -FilePath $exe -ArgumentList $DataDir `
    -PassThru -NoNewWindow
try {
    # Wait for /health before opening the tunnel.
    $healthy = $false
    foreach ($i in 1..30) {
        try {
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($r.status -eq "ok") { $healthy = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) { throw "Server did not become healthy on :$Port" }
    Write-Host "Server healthy." -ForegroundColor Green

    # ── Start the quick tunnel and surface its URL ────────────────
    if ($cloudflared) {
        $out = New-TemporaryFile
        $tunnel = Start-Process -FilePath $cloudflared.Source `
            -ArgumentList @("tunnel", "--url", "http://localhost:$Port", "--no-autoupdate") `
            -PassThru -NoNewWindow -RedirectStandardOutput $out.FullName
        Write-Host "Waiting for tunnel URL…"
        $url = $null
        foreach ($i in 1..60) {
            Start-Sleep -Seconds 1
            $match = Select-String -Path $out.FullName `
                -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" |
                Select-Object -Last 1
            if ($match) {
                $url = $match.Matches[0].Value
                break
            }
        }
        if ($url) {
            Write-Host ""
            Write-Host "=====================================================" -ForegroundColor Cyan
            Write-Host "  Share this URL with your players:" -ForegroundColor Cyan
            Write-Host "  $url" -ForegroundColor Yellow
            Write-Host "  (LAN players can also use http://<your-ip>:$Port)" -ForegroundColor Gray
            Write-Host "=====================================================" -ForegroundColor Cyan
        } else {
            Write-Warning "Tunnel URL not detected yet — check the cloudflared window."
        }

        Write-Host "Press Ctrl+C to stop both processes."
        try { Wait-Process -Id $server.Id } finally {
            if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
        }
    } else {
        Write-Host "Press Ctrl+C to stop."
        Wait-Process -Id $server.Id
    }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
