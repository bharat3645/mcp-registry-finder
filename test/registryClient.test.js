import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRegistryClient, RegistryError } from "../src/registryClient.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

function fakeFetch(handler) {
  return async (url, opts) => handler(url, opts);
}

function jsonResponse(status, bodyText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => bodyText,
  };
}

describe("createRegistryClient", () => {
  test("listServers builds the expected query string and parses the response", async () => {
    let capturedUrl;
    const client = createRegistryClient({
      baseUrl: "https://registry.example",
      fetchImpl: fakeFetch(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, fixture("search-filesystem.json"));
      }),
    });

    const result = await client.listServers({ search: "filesystem", limit: 3 });
    assert.equal(capturedUrl, "https://registry.example/v0/servers?search=filesystem&limit=3");
    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].server.name, "com.pulsemcp/remote-filesystem");
  });

  test("listServers omits absent params from the query string", async () => {
    let capturedUrl;
    const client = createRegistryClient({
      baseUrl: "https://registry.example",
      fetchImpl: fakeFetch(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, fixture("list-servers.json"));
      }),
    });
    await client.listServers({});
    assert.equal(capturedUrl, "https://registry.example/v0/servers");
  });

  test("getServer URL-encodes the server name and version", async () => {
    let capturedUrl;
    const client = createRegistryClient({
      baseUrl: "https://registry.example",
      fetchImpl: fakeFetch(async (url) => {
        capturedUrl = url;
        return jsonResponse(200, fixture("server-detail.json"));
      }),
    });
    const result = await client.getServer("ac.inference.sh/mcp", "latest");
    assert.equal(capturedUrl, "https://registry.example/v0/servers/ac.inference.sh%2Fmcp/versions/latest");
    assert.equal(result.server.name, "ac.inference.sh/mcp");
  });

  test("getServer rejects an empty name without making a request", async () => {
    const client = createRegistryClient({ fetchImpl: fakeFetch(async () => { throw new Error("should not be called"); }) });
    await assert.rejects(() => client.getServer(""), RegistryError);
  });

  test("non-2xx responses raise RegistryError carrying the status", async () => {
    const client = createRegistryClient({
      fetchImpl: fakeFetch(async () => jsonResponse(404, JSON.stringify({ error: "Server not found" }))),
    });
    await assert.rejects(
      () => client.getServer("nope/nope"),
      (err) => err instanceof RegistryError && err.status === 404 && /Server not found/.test(err.message)
    );
  });

  test("non-JSON body raises a RegistryError instead of throwing a raw parse error", async () => {
    const client = createRegistryClient({
      fetchImpl: fakeFetch(async () => jsonResponse(200, "<html>not json</html>")),
    });
    await assert.rejects(() => client.listServers({}), RegistryError);
  });

  test("network failure raises a RegistryError with a helpful message", async () => {
    const client = createRegistryClient({
      fetchImpl: fakeFetch(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    });
    await assert.rejects(
      () => client.listServers({}),
      (err) => err instanceof RegistryError && /Failed to reach MCP registry/.test(err.message)
    );
  });

  test("throws synchronously if fetchImpl is not a function", () => {
    assert.throws(() => createRegistryClient({ fetchImpl: "not-a-function", baseUrl: "https://x" }));
  });
});
