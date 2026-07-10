import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../src/tools.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf8"));

function stubRegistry(overrides = {}) {
  return {
    listServers: overrides.listServers ?? (async () => fixture("list-servers.json")),
    getServer: overrides.getServer ?? (async () => fixture("server-detail.json")),
  };
}

describe("tools.list", () => {
  test("exposes exactly the four documented tools with valid schemas", () => {
    const tools = createTools(stubRegistry());
    const list = tools.list();
    const names = list.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "format_install_command",
      "get_server_details",
      "list_recent_servers",
      "search_registry",
    ]);
    for (const t of list) {
      assert.equal(t.inputSchema.type, "object");
      assert.ok(t.description.length > 0);
    }
  });
});

describe("search_registry", () => {
  test("returns formatted matches and structuredContent on success", async () => {
    const tools = createTools(stubRegistry({
      listServers: async (params) => {
        assert.equal(params.search, "filesystem");
        assert.equal(params.limit, 5);
        return fixture("search-filesystem.json");
      },
    }));
    const result = await tools.call("search_registry", { query: "filesystem", limit: 5 });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Found 1 server/);
    assert.equal(result.structuredContent.servers.length, 1);
  });

  test("rejects an empty query without calling the registry", async () => {
    const tools = createTools(stubRegistry({ listServers: async () => { throw new Error("should not be called"); } }));
    const result = await tools.call("search_registry", { query: "  " });
    assert.equal(result.isError, true);
  });

  test("surfaces registry errors as isError results, not thrown exceptions", async () => {
    const tools = createTools(stubRegistry({ listServers: async () => { throw new Error("boom"); } }));
    const result = await tools.call("search_registry", { query: "x" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /boom/);
  });

  test("clamps an out-of-range limit instead of forwarding it verbatim", async () => {
    let seenLimit;
    const tools = createTools(stubRegistry({
      listServers: async (params) => { seenLimit = params.limit; return fixture("list-servers.json"); },
    }));
    await tools.call("search_registry", { query: "x", limit: 9999 });
    assert.equal(seenLimit, 50);
  });
});

describe("get_server_details", () => {
  test("formats a successful lookup", async () => {
    const tools = createTools(stubRegistry());
    const result = await tools.call("get_server_details", { name: "ac.inference.sh/mcp" });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /inference\.sh/);
  });

  test("maps a 404 registry error to a clear not-found message", async () => {
    const notFound = new Error("Registry error 404: Server not found");
    notFound.status = 404;
    const tools = createTools(stubRegistry({ getServer: async () => { throw notFound; } }));
    const result = await tools.call("get_server_details", { name: "no/such" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No server named "no\/such"/);
  });

  test("rejects a missing name", async () => {
    const tools = createTools(stubRegistry());
    const result = await tools.call("get_server_details", {});
    assert.equal(result.isError, true);
  });
});

describe("list_recent_servers", () => {
  test("passes updated_since derived from updatedWithinDays", async () => {
    let seenParams;
    const tools = createTools(stubRegistry({
      listServers: async (params) => { seenParams = params; return fixture("list-servers.json"); },
    }));
    await tools.call("list_recent_servers", { updatedWithinDays: 7 });
    assert.ok(seenParams.updatedSince);
    const daysAgo = (Date.now() - new Date(seenParams.updatedSince).getTime()) / 86_400_000;
    assert.ok(Math.abs(daysAgo - 7) < 0.01);
  });

  test("rejects a non-positive updatedWithinDays", async () => {
    const tools = createTools(stubRegistry());
    const result = await tools.call("list_recent_servers", { updatedWithinDays: -1 });
    assert.equal(result.isError, true);
  });
});

describe("format_install_command tool", () => {
  test("formats offline, without touching the registry", async () => {
    const tools = createTools(stubRegistry({
      listServers: async () => { throw new Error("must not be called"); },
      getServer: async () => { throw new Error("must not be called"); },
    }));
    const result = await tools.call("format_install_command", { registryType: "npm", identifier: "foo", version: "1.0.0" });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, "npx -y foo@1.0.0");
    assert.equal(result.structuredContent.command, "npx -y foo@1.0.0");
  });
});

describe("unknown tool", () => {
  test("call() throws a recognizable UNKNOWN_TOOL error", async () => {
    const tools = createTools(stubRegistry());
    await assert.rejects(() => tools.call("does_not_exist", {}), (err) => err.code === "UNKNOWN_TOOL");
  });
});
