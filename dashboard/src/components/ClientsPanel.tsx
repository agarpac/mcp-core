import { useState, useEffect } from 'react';
import { fetchClients, type ClientInfo } from '../api/client';

export function ClientsPanel() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClients()
      .then(setClients)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (clients.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="flex items-baseline mb-4 border-b border-gray-800 pb-2">
        <h2 className="text-xl font-bold">AI Clients</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {clients.map((c) => {
          const status = !c.installed
            ? { dot: 'bg-gray-600', label: 'not installed', labelColor: 'text-gray-500' }
            : c.gatewayInjected
            ? { dot: 'bg-green-500', label: 'gateway active', labelColor: 'text-green-400' }
            : { dot: 'bg-yellow-500', label: 'not configured', labelColor: 'text-yellow-400' };

          return (
            <div
              key={c.name}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status.dot}`} />
                <span className="font-semibold text-sm">{c.displayName}</span>
                <span className={`ml-auto text-xs ${status.labelColor}`}>{status.label}</span>
              </div>
              {c.configPath && (
                <code className="text-[11px] text-gray-500 font-mono truncate" title={c.configPath}>
                  {c.configPath}
                </code>
              )}
              {c.installed && !c.gatewayInjected && (
                <p className="text-[11px] text-yellow-600 mt-1">
                  Run <code className="bg-gray-900 px-1 rounded">mcp-core init</code> to inject the gateway.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
