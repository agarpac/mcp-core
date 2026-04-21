import fs from 'fs';
import os from 'os';
import { CLIENT_ADAPTERS, ClientAdapter } from '../../config/paths';

const PROXY_BINARY = 'mcp-proxy';

function resolvePath(adapter: ClientAdapter): string | null {
  const platform = os.platform();
  if (platform !== 'darwin' && platform !== 'linux') return null;
  return adapter.configPath[platform] ?? null;
}

/**
 * Enable/disable a server in a single client's config.
 * - `enable=true` writes the proxy entry.
 * - `enable=false` removes it.
 *
 * NOTE: this will be refactored to a visibility-filter in the gateway config
 * in Step 7 (toggle_client → config.json visibleIn mapping).
 */
export function toggleClientServer(
  serverName: string,
  clientName: string,
  enable: boolean
): void {
  const adapter = CLIENT_ADAPTERS[clientName];
  if (!adapter) {
    throw new Error(`Unknown client: ${clientName}`);
  }

  const filePath = resolvePath(adapter);
  if (!filePath) {
    throw new Error(`Client ${clientName} is not supported on this OS.`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config for ${clientName} not found at ${filePath}.`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const config = raw.trim() ? JSON.parse(raw) : {};

  let updated: unknown;
  if (enable) {
    const record = adapter.serialize({
      name: serverName,
      command: PROXY_BINARY,
      args: [serverName],
    });
    updated = adapter.writeServer(config, serverName, record);
  } else {
    updated = adapter.removeServer(config, serverName);
  }

  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
}
