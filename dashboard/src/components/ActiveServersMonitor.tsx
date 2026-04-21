import { useState, useEffect } from 'react';
import { fetchServers, uninstall, validateServer, type ValidationResult } from '../api/client';

export interface ServerData {
  id: string;
  name: string;
  command: string;
}

type HealthMap = Record<string, { loading: boolean; result?: ValidationResult; error?: string }>;

export function ActiveServersMonitor() {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthMap>({});

  useEffect(() => {
    fetchServers()
      .then((json) => {
        const serverList = Object.entries(json).map(([name, config]: [string, any]) => ({
          id: name,
          name,
          command: `${config.command} ${config.args ? config.args.join(' ') : ''}`.trim(),
        }));
        setServers(serverList);
        setError(null);
      })
      .catch(() => setError('Failed to load active servers'))
      .finally(() => setLoading(false));
  }, []);

  const runCheck = async (name: string) => {
    setHealth((h) => ({ ...h, [name]: { loading: true } }));
    try {
      const result = await validateServer({ name });
      setHealth((h) => ({ ...h, [name]: { loading: false, result } }));
    } catch (e: any) {
      setHealth((h) => ({ ...h, [name]: { loading: false, error: e?.message ?? String(e) } }));
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      await uninstall({ name: id });
      window.location.reload();
    } catch (e: any) {
      alert('Uninstall failed: ' + (e?.message ?? e));
    }
  };

  const renderHealth = (name: string) => {
    const h = health[name];
    if (!h) {
      return (
        <button
          onClick={() => runCheck(name)}
          className="text-xs text-gray-400 hover:text-blue-400 underline"
        >
          Check
        </button>
      );
    }
    if (h.loading) return <span className="text-xs text-gray-400">Checking…</span>;
    if (h.error) return <span className="text-xs text-red-400" title={h.error}>Error</span>;
    if (!h.result) return null;
    if (h.result.success) {
      return (
        <span className="text-xs text-emerald-400" title={`${h.result.latencyMs}ms`}>
          🟢 {h.result.tools} tools
        </span>
      );
    }
    return (
      <span className="text-xs text-red-400" title={h.result.error ?? 'unknown'}>
        🔴 {h.result.error ?? 'failed'}
      </span>
    );
  };

  if (loading) return <div className="p-4 text-gray-300">Loading active servers...</div>;
  if (error) return <div className="p-4 text-red-400">{error}</div>;

  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold mb-4 border-b border-gray-800 pb-2">Active MCP Servers</h2>
      <div className="bg-gray-800 rounded-lg shadow border border-gray-700 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Server</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Command</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Health</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {servers.map((server) => (
              <tr key={server.id} className="hover:bg-gray-750">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-green-500 mr-3"></div>
                    <span className="font-semibold">{server.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="font-mono text-sm bg-gray-900 px-2 py-1 rounded text-gray-300 truncate block max-w-xs" title={server.command}>
                    {server.command}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {renderHealth(server.name)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => runCheck(server.id)} className="text-blue-400 hover:text-blue-300 mx-2">Re-validate</button>
                  <button onClick={() => handleUninstall(server.id)} className="text-red-400 hover:text-red-300 mx-2">Uninstall</button>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No MCP servers currently installed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
