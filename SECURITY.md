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
- The HTTP transport currently serves a single session without auth. Do **not**
  expose it publicly without an auth proxy in front; supply-chain-wise, the
  registry `remotes[]` entry must point at a host you control (see `server.json`).
- Report files are written under `RESEARCH_SCOPE_DATA_DIR` (default `./data`) with
  no secrets embedded — scrape inputs are the only external data stored.
