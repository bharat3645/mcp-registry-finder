#!/usr/bin/env node
// index.js — stdio transport entrypoint for mcp-registry-finder.
// Per the MCP spec's stdio transport: read newline-delimited JSON-RPC
// messages from stdin, write newline-delimited JSON-RPC messages to stdout,
// and never write anything else to stdout. Logs go to stderr only.

import { createInterface } from "node:readline";
import { createRegistryClient } from "./registryClient.js";
import { createTools } from "./tools.js";
import { createServer, tryParseJsonRpc, ERROR_CODES } from "./server.js";

const pkgVersion = "0.1.0";

function log(...args) {
  console.error("[mcp-registry-finder]", ...args);
}

function main() {
  const registry = createRegistryClient({ baseUrl: process.env.MCP_REGISTRY_FINDER_BASE_URL });
  const tools = createTools(registry);
  const server = createServer({
    serverInfo: { name: "mcp-registry-finder", title: "MCP Registry Finder", version: pkgVersion },
    tools,
  });

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parsed = tryParseJsonRpc(trimmed);
    if (!parsed.ok) {
      writeMessage({
        jsonrpc: "2.0",
        id: null,
        error: { code: ERROR_CODES.PARSE_ERROR, message: `Parse error: ${parsed.error.message}` },
      });
      return;
    }

    const response = await server.handleMessage(parsed.value);
    if (response !== null) writeMessage(response);
  });

  rl.on("close", () => {
    log("stdin closed, exiting");
    process.exit(0);
  });

  log(`ready (registry base: ${registry.baseUrl})`);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

main();
