# Bitidea Desktop Sidecar

A small FastAPI process spawned by the Tauri shell. Exposes an HTTP+SSE
API on `127.0.0.1` that the React UI talks to. Completely self-contained
for v0.1 — it calls the configured LLM directly and does not depend on
the `bitidea-agent` package.

## Run standalone (for testing)

```sh
cd sidecar
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m sidecar
```

The first three stdout lines are the handshake the Tauri parent reads:

```
SIDECAR_PORT=<port>
SIDECAR_TOKEN=<hex>
SIDECAR_READY
```

The port is chosen automatically from the OS ephemeral range each run.

## Endpoints

All endpoints except `GET /health` require the `X-Bitidea-Token` header
to match the token printed at startup.

| Method | Path                | Purpose                                   |
| ------ | ------------------- | ----------------------------------------- |
| GET    | `/health`           | Readiness probe (`{ok, version}`)         |
| GET    | `/config`           | Current config minus the API key         |
| POST   | `/config`           | Save `{provider, model, api_key, base_url?}` to `~/.bitidea-desktop/config.json` (mode 0600) |
| POST   | `/test-connection`  | Verify the API key against the provider   |
| POST   | `/chat`             | SSE stream of tokens from the LLM         |

### Chat SSE format

```
event: token
data: {"text": "Hello"}

event: token
data: {"text": " world"}

event: done
data: {}
```

Errors come back as `event: error\ndata: {"message": "..."}` instead of
an HTTP error code once the stream has opened.

## Quick curl test

```sh
TOKEN=...   # copied from the SIDECAR_TOKEN stdout line
PORT=...    # copied from SIDECAR_PORT

curl -s "http://127.0.0.1:$PORT/health"

curl -s -X POST "http://127.0.0.1:$PORT/config" \
  -H "X-Bitidea-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini","api_key":"sk-..."}'

curl -N -X POST "http://127.0.0.1:$PORT/chat" \
  -H "X-Bitidea-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

## Security

- Binds to `127.0.0.1` only — never `0.0.0.0`.
- Every non-`/health` request must carry the one-shot `X-Bitidea-Token`
  header generated at boot. This blocks drive-by localhost attacks from
  other processes on the same machine.
- Config file written with mode `0600` inside a `0700` directory.
- No websockets, no multi-user auth, no rate limiting — this is a
  single-user desktop sidecar.
