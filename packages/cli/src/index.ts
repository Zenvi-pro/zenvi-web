// @zenvi/cli programmatic API (the `zenvi` binary is src/bin.ts).
export { runCli, buildProgram, type RunCliOptions } from "./program.js";
export { loadConfig, DEFAULTS, type ZenviConfig } from "./config.js";
export { createZenviMcpServer, runStdioServer, SERVER_INSTRUCTIONS } from "./mcp/server.js";
export { discoverDesktop, type DesktopEndpoint } from "./desktop/discovery.js";
export { openInDesktop } from "./desktop/open.js";
export { mcpConfig, AGENT_TARGETS, type AgentTarget } from "./agents/mcp-config.js";
export { VERSION } from "./version.js";
