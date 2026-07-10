# mcp-registry-finder

**Search the official MCP Registry from inside your agent session.**

An MCP server that wraps the official [Model Context Protocol
Registry](https://registry.modelcontextprotocol.io) REST API as MCP tools — so
a Claude Code / Claude Desktop / Cursor session can find, inspect, and get
install commands for published MCP servers without you tabbing over to a
browser.

`github.com/bharat3645/mcp-registry-finder` · MIT · built by Bharat

---

## The problem

By mid-2026 the MCP server ecosystem is large and fragmented: the official
registry alone lists thousands of published servers, and third-party
directories (mcp.so, LobeHub, and others) each index tens of thousands more,
with no single, consistent way to search. If you're inside an agent session
and want to know "is there already an MCP server for X" or "what's the exact
install command for that GitHub MCP server," today you leave the chat, open a
browser, and search a directory by hand.

This is the missing meta-tool: an MCP server whose whole job is making the
**official** registry queryable from *inside* the session that would actually
use the result.

## What it is

Four tools, each doing one job:

| Tool | What it does |
|---|---|
| `search_registry` | Substring-search the registry by server name; returns matches with version, status, and description. |
| `get_server_details` | Full detail for one server by its reverse-DNS name — packages, required env vars, remote endpoints. |
| `list_recent_servers` | List servers, optionally filtered to those updated in the last *N* days. |
| `format_install_command` | Offline helper: turn a `{registryType, identifier}` pair into a runnable install command (`npx`, `uvx`, `docker run`, `dnx`, `cargo install`, …). Makes no network call. |

It talks to the **official** registry only (`registry.modelcontextprotocol.io`,
the registry stood up under the `modelcontextprotocol/registry` project) — not
the larger unofficial directories, which have no single stable API.

## Install

### Claude Code

```bash
claude mcp add registry-finder -- npx -y mcp-registry-finder
```

### Claude Desktop / other MCP hosts

Add to your MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "registry-finder": {
      "command": "npx",
      "args": ["-y", "mcp-registry-finder"]
    }
  }
}
```

### Run from source

```bash
git clone https://github.com/bharat3645/mcp-registry-finder && cd mcp-registry-finder
npm test           # 40 tests, node:test, zero test-framework dependencies
npm start           # runs the stdio server directly
```

There is nothing to build — the package ships as plain ESM JavaScript and has
**zero runtime dependencies**: it uses Node's built-in global `fetch` (Node
≥18) and `node:readline` for the stdio transport.

## Example

Once installed, ask your agent things like:

> "Is there an MCP server for Slack in the official registry?"
> "Give me the install command for the filesystem MCP server."
> "What's been published to the registry in the last 3 days?"

which route to `search_registry`, `search_registry` + `get_server_details`,
and `list_recent_servers({ updatedWithinDays: 3 })` respectively.

## Architecture

```
stdin ──► readline (newline-delimited JSON-RPC) ──► server.js (protocol) ──► tools.js ──► registryClient.js ──► registry.modelcontextprotocol.io
stdout ◄── JSON-RPC responses                    ◄──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

- `src/server.js` — transport-agnostic JSON-RPC message handling
  (`initialize`, `ping`, `tools/list`, `tools/call`), so protocol logic is
  unit-testable without spawning a process.
- `src/index.js` — the stdio transport shim: one JSON-RPC message per line in,
  one per line out, logs on stderr only, per the
  [stdio transport spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio).
- `src/registryClient.js` — thin fetch wrapper over the registry's `/v0`
  endpoints, with an injectable `fetchImpl` for testing.
- `src/tools.js` / `src/format.js` — tool schemas/handlers and pure formatting
  helpers (install-command derivation, summaries).

Targets protocol versions `2025-06-18` and `2025-03-26` (negotiated at
`initialize`, defaulting to `2025-06-18`). The registry's own transport
(Streamable HTTP for remote servers, stdio/HTTP for local packages) is
unrelated to this server's *own* transport, which is always stdio.

## Verification

- **40 tests** on `node:test`, zero test-framework dependencies (`npm test`).
- `registryClient` and `tools` are unit-tested against **real recorded
  responses** captured from the live registry API on 2026-07-10 (see
  `fixtures/`) via an injected fetch, covering success, 404, non-JSON, and
  network-failure paths.
- `format.js` (install-command derivation, summaries) is pure and exhaustively
  unit-tested — npm, pypi (uvx and pip variants), oci, nuget, cargo, mcpb, and
  the unrecognized-type fallback.
- `test/protocol.test.js` spawns the real server binary and drives it over
  actual stdin/stdout pipes — a genuine end-to-end test of the JSON-RPC
  framing, restricted to the tools that need no network (`initialize`, `ping`,
  `tools/list`, `format_install_command`) so the suite never depends on
  internet access being available wherever it runs.
- `node --check` passes on every source and test file.

## Scope, stated plainly

- **Read-only.** The registry API also defines optional `publish` /
  `update` / `delete` endpoints gated by bearer auth; this server doesn't
  implement them — it's a finder, not a publisher.
- **No live-network integration test ships in this repo.** The registry
  client's HTTP-calling code is unit-tested against real, recorded API
  responses (not live calls) so the suite is deterministic and runs offline;
  the request/response shapes were hand-verified against the live registry
  while building this. If the registry changes its response shape, the unit
  tests won't catch that on their own — recapture the fixtures under
  `fixtures/` from a live `GET /v0/servers` call to re-verify.
- **Targets the stable spec, not the bleeding edge.** The registry's own API
  doc set references both a deployed `/v0` path and a documented `/v0.1`
  OpenAPI schema; this client targets the deployed `/v0` path (verified live)
  and exposes `baseUrl` as an override (`MCP_REGISTRY_FINDER_BASE_URL`) in
  case that changes. Likewise, this server negotiates the current stable MCP
  protocol versions (`2025-06-18` / `2025-03-26`), not the `2026-07-28`
  stateless-protocol release candidate, since that RC isn't final or widely
  supported by hosts yet.
- **Substring search only.** `search_registry` matches on server name, which
  is what the registry's `search` query parameter does server-side — there's
  no fuzzy or semantic matching layer on top.

## License

MIT.
