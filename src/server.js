// server.js — transport-agnostic MCP JSON-RPC message handling.
// Kept separate from stdio wiring (index.js) so the protocol logic can be
// unit-tested by calling handleMessage() directly with plain objects.

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * @param {object} opts
 * @param {{name: string, version: string, title?: string}} opts.serverInfo
 * @param {ReturnType<import('./tools.js').createTools>} opts.tools
 */
export function createServer({ serverInfo, tools }) {
  function ok(id, result) {
    return { jsonrpc: "2.0", id, result };
  }
  function fail(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: "2.0", id: id ?? null, error };
  }

  /**
   * Handle one already-parsed JSON-RPC message.
   * Returns a response object for requests, or `null` for notifications
   * (including malformed messages with no `id`, per JSON-RPC semantics).
   */
  async function handleMessage(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return fail(null, INVALID_REQUEST, "Invalid Request: expected a JSON-RPC object");
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined;

    if (msg.jsonrpc !== "2.0" || typeof method !== "string") {
      return isNotification ? null : fail(id, INVALID_REQUEST, "Invalid Request: missing jsonrpc/method");
    }

    try {
      switch (method) {
        case "initialize": {
          const requested = params?.protocolVersion;
          const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : LATEST_PROTOCOL_VERSION;
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo,
            instructions:
              "Use search_registry to find MCP servers by keyword, get_server_details for install " +
              "instructions on a specific server, list_recent_servers to see what's newly published, " +
              "and format_install_command to render an install command offline.",
          });
        }

        case "notifications/initialized":
          return null; // notification: no response

        case "ping":
          return ok(id, {});

        case "tools/list":
          return ok(id, { tools: tools.list() });

        case "tools/call": {
          if (!params || typeof params.name !== "string") {
            return fail(id, INVALID_PARAMS, "tools/call requires params.name");
          }
          try {
            const result = await tools.call(params.name, params.arguments);
            return ok(id, result);
          } catch (err) {
            if (err.code === "UNKNOWN_TOOL") {
              return fail(id, INVALID_PARAMS, err.message);
            }
            throw err;
          }
        }

        default:
          return isNotification ? null : fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      return isNotification ? null : fail(id, INVALID_PARAMS, `Internal error handling ${method}: ${err.message}`);
    }
  }

  return { handleMessage };
}

export function tryParseJsonRpc(line) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export const ERROR_CODES = { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS };
