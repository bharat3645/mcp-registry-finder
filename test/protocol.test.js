// protocol.test.js — genuine end-to-end test of the stdio transport: spawns
// the real server binary as a child process and exchanges newline-delimited
// JSON-RPC over real stdin/stdout pipes, exactly as a host application would.
// Deliberately exercises only network-free operations (initialize, ping,
// tools/list, and the offline format_install_command tool) so this suite
// never depends on internet access being available in the test environment.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "src", "index.js");

let child;
let rl;
let nextId = 1;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function sendNotification(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function sendRaw(line) {
  child.stdin.write(`${line}\n`);
}

before(() => {
  child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  rl = createInterface({ input: child.stdout, terminal: false });
  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
});

after(() => {
  rl.close();
  child.kill();
});

test("initialize negotiates a supported protocol version and advertises tools capability", async () => {
  const res = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  });
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.equal(res.result.serverInfo.name, "mcp-registry-finder");
  assert.ok(res.result.capabilities.tools);

  sendNotification("notifications/initialized");
});

test("ping returns an empty result", async () => {
  const res = await send("ping");
  assert.deepEqual(res.result, {});
});

test("tools/list returns all four tools over the wire", async () => {
  const res = await send("tools/list");
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "format_install_command",
    "get_server_details",
    "list_recent_servers",
    "search_registry",
  ]);
});

test("tools/call executes the offline format_install_command tool end-to-end", async () => {
  const res = await send("tools/call", {
    name: "format_install_command",
    arguments: { registryType: "npm", identifier: "@modelcontextprotocol/server-filesystem", version: "1.0.2" },
  });
  assert.equal(res.result.isError, undefined);
  assert.equal(res.result.content[0].text, "npx -y @modelcontextprotocol/server-filesystem@1.0.2");
});

test("tools/call on an unknown tool returns a JSON-RPC error, per spec example shape", async () => {
  const res = await send("tools/call", { name: "not_a_real_tool", arguments: {} });
  assert.equal(res.result, undefined);
  assert.equal(res.error.code, -32602);
  assert.match(res.error.message, /Unknown tool/);
});

test("an unknown method returns Method not found", async () => {
  const res = await send("totally/bogus");
  assert.equal(res.error.code, -32601);
});

test("malformed JSON on stdin gets a Parse error response, not a crash", async () => {
  sendRaw("{ not valid json");
  const res = await send("ping"); // if the server crashed, this would hang/timeout
  assert.deepEqual(res.result, {});
});
