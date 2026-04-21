/**
 * Tests for the gateway MCP server.
 *
 * Strategy:
 *   - Inject a mock DaemonMetaClient (no real socket, no subprocess).
 *   - Use `InMemoryTransport.createLinkedPair()` for client ↔ server transport.
 *   - Mock the underlying CLI commands for the mcp_core__ control tools.
 */
export {};
//# sourceMappingURL=server.test.d.ts.map