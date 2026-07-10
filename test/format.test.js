import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatInstallCommand, summarizeServer, formatServerDetail } from "../src/format.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf8"));

describe("formatInstallCommand", () => {
  test("npm package", () => {
    assert.equal(
      formatInstallCommand({ registryType: "npm", identifier: "@modelcontextprotocol/server-filesystem", version: "1.0.2" }),
      "npx -y @modelcontextprotocol/server-filesystem@1.0.2"
    );
  });

  test("npm package without version", () => {
    assert.equal(formatInstallCommand({ registryType: "npm", identifier: "some-pkg" }), "npx -y some-pkg");
  });

  test("pypi defaults to uvx", () => {
    assert.equal(formatInstallCommand({ registryType: "pypi", identifier: "mcp-server-git" }), "uvx mcp-server-git");
  });

  test("pypi with pip runtimeHint", () => {
    assert.equal(
      formatInstallCommand({ registryType: "pypi", identifier: "mcp-server-git", runtimeHint: "pip" }),
      "pip install mcp-server-git"
    );
  });

  test("oci package", () => {
    assert.equal(
      formatInstallCommand({ registryType: "oci", identifier: "example/mcp-tool", version: "1.2.3" }),
      "docker run --rm -i example/mcp-tool:1.2.3"
    );
  });

  test("nuget package", () => {
    assert.equal(formatInstallCommand({ registryType: "nuget", identifier: "Example.Mcp" }), "dnx Example.Mcp");
  });

  test("cargo package", () => {
    assert.equal(formatInstallCommand({ registryType: "cargo", identifier: "mcp-tool" }), "cargo install mcp-tool");
  });

  test("mcpb bundle", () => {
    assert.match(formatInstallCommand({ registryType: "mcpb", identifier: "https://example.com/a.mcpb" }), /mcpb bundle/);
  });

  test("unknown registry type does not throw, returns a note", () => {
    const out = formatInstallCommand({ registryType: "weird", identifier: "x" });
    assert.match(out, /unrecognized package registry/);
  });

  test("missing identifier throws", () => {
    assert.throws(() => formatInstallCommand({ registryType: "npm" }));
  });
});

describe("summarizeServer / formatServerDetail against real recorded fixtures", () => {
  test("summarizeServer produces a one-liner with name, version flag, status, description", () => {
    const data = fixture("list-servers.json");
    const line = summarizeServer(data.servers[0]);
    assert.match(line, /ac\.inference\.sh\/mcp/);
    assert.match(line, /latest/);
    assert.match(line, /active/);
    assert.match(line, /Run 150\+ AI apps/);
  });

  test("formatServerDetail includes remotes for a remote-only server", () => {
    const data = fixture("server-detail.json");
    const detail = formatServerDetail(data);
    assert.match(detail, /inference\.sh/);
    assert.match(detail, /remote endpoints:/);
    assert.match(detail, /streamable-http: https:\/\/sh\.inference\.ac/);
  });

  test("formatServerDetail includes install command + required env for a packaged server", () => {
    const data = fixture("search-filesystem.json");
    const detail = formatServerDetail(data.servers[0]);
    assert.match(detail, /npx -y remote-filesystem-mcp-server@0\.1\.5/);
    assert.match(detail, /required env: GCS_BUCKET/);
  });
});
