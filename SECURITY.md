# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✓ |

## Reporting a vulnerability

Email **security@axelverne.example** (replace with the live mailbox before first
publish) or open a private GitHub security advisory on this repo. Please include:
affected version, transport (stdio/HTTP), and a minimal reproduction. Expect an
acknowledgment within 72h and a fix or mitigation within 30 days for confirmed
issues.

## Scope notes

- `fetch_and_score` performs outbound HTTP GETs to caller-supplied URLs. In
  zero-trust environments, run the server inside a network-restricted container
  (the provided [docker/Dockerfile](docker/Dockerfile) exposes only the MCP port).
- The HTTP transport is stateless and has **no authentication**. It binds to
  `127.0.0.1` unless `--host` says otherwise. Do **not** expose it publicly without
  an authenticating proxy in front: any caller can make the server fetch URLs and
  can point `check_report`'s `report_path` at local files. Supply-chain-wise, a
  registry `remotes[]` entry must point at a host you control (see `server.json`).
- `fetch_and_score` accepts only `http://` and `https://` URLs, aborts after 15 s
  and reads at most 5 MB per response.
- Report files are written under `RESEARCH_SCOPE_DATA_DIR` (default `./data`) with
  no secrets embedded — scrape inputs are the only external data stored.
