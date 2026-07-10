// tools.js — MCP tool definitions + handlers for mcp-registry-finder.
// Each handler returns an MCP CallToolResult shape: { content: [...], isError?, structuredContent? }.

import { formatInstallCommand, formatServerDetail, summarizeServer } from "./format.js";

function textResult(text, structuredContent) {
  const result = { content: [{ type: "text", text }] };
  if (structuredContent !== undefined) result.structuredContent = structuredContent;
  return result;
}

function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

/** @param {import('./registryClient.js').createRegistryClient extends (...a:any)=>infer R ? R : never} registry */
export function createTools(registry) {
  const tools = [
    {
      name: "search_registry",
      title: "Search the MCP Registry",
      description:
        "Search the official Model Context Protocol registry (registry.modelcontextprotocol.io) for published MCP servers by substring match on name. Returns matching servers with version, status, and description.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to match against server names, e.g. 'filesystem' or 'github'." },
          limit: { type: "integer", description: "Max results to return (1-50).", minimum: 1, maximum: 50, default: 10 },
        },
        required: ["query"],
      },
      async handler(args) {
        const query = String(args?.query ?? "").trim();
        if (!query) return errorResult("search_registry requires a non-empty 'query'.");
        const limit = clampLimit(args?.limit, 10, 50);

        try {
          const page = await registry.listServers({ search: query, limit });
          const servers = page.servers ?? [];
          if (!servers.length) {
            return textResult(`No MCP registry servers matched "${query}".`, { servers: [] });
          }
          const lines = servers.map((entry, i) => `${i + 1}. ${summarizeServer(entry)}`);
          const more = page.metadata?.nextCursor ? `\n\n(more results available; pass cursor "${page.metadata.nextCursor}" to a future search to page further)` : "";
          return textResult(
            `Found ${servers.length} server(s) matching "${query}":\n\n${lines.join("\n")}${more}`,
            { servers }
          );
        } catch (err) {
          return errorResult(`Registry search failed: ${err.message}`);
        }
      },
    },
    {
      name: "get_server_details",
      title: "Get MCP server details",
      description:
        "Fetch full details for one MCP server from the official registry by its reverse-DNS name (e.g. 'io.github.user/weather'), including install packages, required environment variables, and remote endpoints.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Reverse-DNS registry name, e.g. 'io.github.user/weather'." },
          version: { type: "string", description: "Specific version, or 'latest' (default).", default: "latest" },
        },
        required: ["name"],
      },
      async handler(args) {
        const name = String(args?.name ?? "").trim();
        if (!name) return errorResult("get_server_details requires a non-empty 'name'.");
        const version = args?.version ? String(args.version) : "latest";

        try {
          const entry = await registry.getServer(name, version);
          return textResult(formatServerDetail(entry), entry);
        } catch (err) {
          if (err.status === 404) {
            return errorResult(`No server named "${name}" (version "${version}") was found in the registry.`);
          }
          return errorResult(`Failed to fetch "${name}": ${err.message}`);
        }
      },
    },
    {
      name: "list_recent_servers",
      title: "List recently updated MCP servers",
      description:
        "List MCP servers from the official registry, optionally filtered to those updated within the last N days. Useful for spotting newly published servers.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max results to return (1-50).", minimum: 1, maximum: 50, default: 10 },
          updatedWithinDays: { type: "integer", description: "Only include servers updated within this many days.", minimum: 1 },
        },
      },
      async handler(args) {
        const limit = clampLimit(args?.limit, 10, 50);
        const params = { limit };
        if (args?.updatedWithinDays != null) {
          const days = Number(args.updatedWithinDays);
          if (!Number.isFinite(days) || days <= 0) {
            return errorResult("updatedWithinDays must be a positive number.");
          }
          params.updatedSince = new Date(Date.now() - days * 86_400_000).toISOString();
        }

        try {
          const page = await registry.listServers(params);
          const servers = page.servers ?? [];
          if (!servers.length) {
            return textResult("No servers matched.", { servers: [] });
          }
          const lines = servers.map((entry, i) => `${i + 1}. ${summarizeServer(entry)}`);
          return textResult(`${servers.length} server(s):\n\n${lines.join("\n")}`, { servers });
        } catch (err) {
          return errorResult(`Registry listing failed: ${err.message}`);
        }
      },
    },
    {
      name: "format_install_command",
      title: "Format an install command for a registry package",
      description:
        "Offline helper: given a package registryType (npm, pypi, oci, nuget, cargo, mcpb) and identifier, return the runnable install/launch command. Does not contact the network.",
      inputSchema: {
        type: "object",
        properties: {
          registryType: { type: "string", enum: ["npm", "pypi", "oci", "nuget", "cargo", "mcpb"] },
          identifier: { type: "string", description: "Package identifier, e.g. '@modelcontextprotocol/server-filesystem'." },
          version: { type: "string", description: "Optional specific version." },
          runtimeHint: { type: "string", description: "Optional runtime hint (e.g. 'pip' to prefer pip over uvx for pypi)." },
        },
        required: ["registryType", "identifier"],
      },
      async handler(args) {
        try {
          const command = formatInstallCommand({
            registryType: args?.registryType,
            identifier: args?.identifier,
            version: args?.version,
            runtimeHint: args?.runtimeHint,
          });
          return textResult(command, { command });
        } catch (err) {
          return errorResult(err.message);
        }
      },
    },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    list() {
      return tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
    },
    async call(name, args) {
      const tool = byName.get(name);
      if (!tool) {
        const err = new Error(`Unknown tool: ${name}`);
        err.code = "UNKNOWN_TOOL";
        throw err;
      }
      return tool.handler(args ?? {});
    },
  };
}

function clampLimit(value, fallback, max) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
