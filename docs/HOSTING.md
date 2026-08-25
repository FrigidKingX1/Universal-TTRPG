# Hosting — Remote Play over Cloudflare Tunnel

The Axum multiplayer server binds `0.0.0.0:3000` (override with the `ADDR`
env var). Players on your LAN can already reach it at
`http://<your-lan-ip>:3000`. To let remote friends connect **without port
forwarding**, front it with a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared`). Tunnels proxy WebSockets transparently, which is all this
server needs — there is no sticky session or binary protocol requirement.

## One-off: install cloudflared

- Windows (winget): `winget install --id Cloudflare.cloudflared`
- Or download the standalone exe:
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## Quick tunnel (ad-hoc game night, zero config)

1. Start the server:

   ```powershell
   # repo root — builds and runs, sessions stored in .\sessions
   cargo run --release -p auto-dm-server
   # or point at a data dir: cargo run --release -p auto-dm-server -- D:\auto-dm-sessions
   ```

2. In a second terminal, expose it:

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

3. `cloudflared` prints an ephemeral URL like
   `https://random-words.trycloudflare.com`. Give that to your players.

4. In the app's Multiplayer panel, players enter that URL as the server.
   The client converts `https://` to a valid `wss://` WebSocket address
   automatically (`toWebSocketUrl()` in `src/multiplayer/client.ts`).

Notes on quick tunnels:

- The URL changes every run and is rate-limited — fine for one evening.
- No Cloudflare account is needed for quick tunnels.

## Named tunnel (persistent table, stable URL)

For a regular group, create a named tunnel once and reuse it:

```powershell
cloudflared tunnel login                       # browser auth
cloudflared tunnel create autodm               # one-time
cloudflared tunnel route dns autodm table.example.com

# config.yml (next to cloudflared, or %USERPROFILE%\.cloudflared\config.yml)
# tunnel: <tunnel-uuid>
# credentials-file: C:\Users\<you>\.cloudflared\<tunnel-uuid>.json
# ingress:
#   - hostname: table.example.com
#     service: http://localhost:3000
#   - service: http_status:404

cloudflared tunnel run autodm
```

Now `https://table.example.com` always reaches this machine's server while
`cloudflared` runs. Pair it with `scripts/serve-public.ps1`, which starts
both processes for you when `cloudflared` is on PATH.

## Security model

- Session join codes + per-player bearer tokens gate every HTTP route and
  the WebSocket handshake (`?token=` query param) — a public URL does not
  expose sessions by itself.
- Anyone with the join code can still create a player slot; treat the code
  like a table password. Re-create the session between groups if needed.
- axum's `WebSocketUpgrade` performs no Origin validation; behind a tunnel
  that is acceptable because the token remains required, but do not rely
  on browser same-origin as an additional layer here.

## Health check

`GET /health` returns `{"status":"ok"}` — useful as the tunnel's probe or
for uptime monitors.
