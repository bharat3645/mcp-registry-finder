// registryClient.js — thin, dependency-free client for the official MCP Registry
// REST API (https://registry.modelcontextprotocol.io). Uses Node's built-in
// global `fetch` (Node >=18) so the package ships with zero npm dependencies.
//
// Verified against the live API on 2026-07-10:
//   GET /v0/servers?search=&limit=&cursor=&updated_since=&version=&include_deleted=
//   GET /v0/servers/{urlencoded name}/versions/{version|latest}
//
// The registry's own OpenAPI document (docs/reference/api/openapi.yaml in
// modelcontextprotocol/registry) describes a `/v0.1/...` path family; the
// deployed production API answers on `/v0/...` with the same query contract,
// so this client targets `/v0` and can be repointed via DEFAULT_BASE_URL.

export const DEFAULT_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_TIMEOUT_MS = 10_000;

export class RegistryError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 */
export function createRegistryClient(opts = {}) {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "No fetch implementation available. Run on Node >=18 or pass opts.fetchImpl."
    );
  }

  async function request(path) {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new RegistryError(`Registry request timed out after ${timeoutMs}ms: ${url}`, { cause: err });
      }
      throw new RegistryError(`Failed to reach MCP registry at ${url}: ${err.message}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    let body;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch (err) {
      throw new RegistryError(`Registry returned non-JSON response (status ${res.status}) from ${url}`, { status: res.status, cause: err });
    }

    if (!res.ok) {
      const message = (body && body.error) || res.statusText || "Unknown registry error";
      throw new RegistryError(`Registry error ${res.status}: ${message}`, { status: res.status });
    }
    return body;
  }

  /**
   * List / search servers.
   * @param {object} [params]
   * @param {string} [params.search] substring match on server name
   * @param {number} [params.limit]
   * @param {string} [params.cursor]
   * @param {string} [params.updatedSince] RFC3339 timestamp
   * @param {string} [params.version] exact version, or 'latest'
   * @param {boolean} [params.includeDeleted]
   */
  async function listServers(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.updatedSince) qs.set("updated_since", params.updatedSince);
    if (params.version) qs.set("version", params.version);
    if (params.includeDeleted != null) qs.set("include_deleted", String(params.includeDeleted));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/v0/servers${suffix}`);
  }

  /**
   * Fetch one server at a specific version (default: latest).
   * @param {string} name reverse-DNS server name, e.g. "io.github.user/weather"
   * @param {string} [version]
   */
  async function getServer(name, version = "latest") {
    if (!name || typeof name !== "string") {
      throw new RegistryError("getServer requires a non-empty server name");
    }
    const encodedName = encodeURIComponent(name);
    const encodedVersion = encodeURIComponent(version);
    return request(`/v0/servers/${encodedName}/versions/${encodedVersion}`);
  }

  return { listServers, getServer, baseUrl };
}
