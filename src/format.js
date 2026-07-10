// format.js — pure, offline, dependency-free formatting helpers.
// No network calls happen in this file, which is what makes it safe to unit
// test exhaustively and to expose as the one fully-offline tool
// (format_install_command).

/**
 * Given a registry package descriptor (the shape returned under
 * server.packages[] by the MCP Registry API), produce a human-runnable
 * install command. Falls back to a generic note for registry types we don't
 * special-case yet, instead of guessing wrong.
 */
export function formatInstallCommand({ registryType, identifier, version, runtimeHint }) {
  if (!registryType || !identifier) {
    throw new Error("formatInstallCommand requires registryType and identifier");
  }
  const versioned = version ? `@${version}` : "";

  switch (registryType) {
    case "npm":
      return `npx -y ${identifier}${versioned}`;
    case "pypi":
      return runtimeHint === "pip"
        ? `pip install ${identifier}${versioned}`
        : `uvx ${identifier}${versioned}`;
    case "oci":
      return `docker run --rm -i ${identifier}${version ? `:${version}` : ""}`;
    case "nuget":
      return `dnx ${identifier}${versioned}`;
    case "cargo":
      return `cargo install ${identifier}${versioned}`;
    case "mcpb":
      return `# download and install the .mcpb bundle: ${identifier}`;
    default:
      return `# unrecognized package registry '${registryType}' — see repository for install instructions (${identifier}${versioned})`;
  }
}

/** One-line summary for a server entry as returned by list/search. */
export function summarizeServer(entry) {
  const s = entry.server;
  const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
  const status = meta?.status ?? "unknown";
  const latestFlag = meta?.isLatest ? "latest" : `v${s.version}`;
  return `${s.name} (${latestFlag}, ${status}) — ${s.description}`;
}

/** Full, multi-line human-readable detail block for a single server entry. */
export function formatServerDetail(entry) {
  const s = entry.server;
  const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
  const lines = [];
  lines.push(`${s.title ? `${s.title} ` : ""}(${s.name}) — v${s.version}`);
  lines.push(s.description);
  if (meta) {
    lines.push(`status: ${meta.status}${meta.isLatest ? " (latest)" : ""}; updated: ${meta.updatedAt ?? "unknown"}`);
  }
  if (s.repository?.url) {
    lines.push(`repository: ${s.repository.url}`);
  }
  if (s.websiteUrl) {
    lines.push(`website: ${s.websiteUrl}`);
  }

  const packages = s.packages ?? [];
  if (packages.length) {
    lines.push("install:");
    for (const pkg of packages) {
      lines.push(`  - ${formatInstallCommand(pkg)}`);
      const required = (pkg.environmentVariables ?? []).filter((v) => v.isRequired);
      if (required.length) {
        lines.push(`    required env: ${required.map((v) => v.name).join(", ")}`);
      }
    }
  }

  const remotes = s.remotes ?? [];
  if (remotes.length) {
    lines.push("remote endpoints:");
    for (const r of remotes) {
      lines.push(`  - ${r.type}: ${r.url}`);
    }
  }

  if (!packages.length && !remotes.length) {
    lines.push("(no packages or remotes published for this version)");
  }

  return lines.join("\n");
}
