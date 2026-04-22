import { useState, useEffect, useCallback } from 'react';
import { fetchServers, fetchSystem, fetchActiveServers, uninstall, stopServer, validateServer, fetchLogs, type ValidationResult, type ServerLogsInfo, type McpServerKind } from '../api/client';

export interface ServerData {
  id: string;
  name: string;
  command: string;
  kind?: McpServerKind;
}

type HealthMap = Record<string, { loading: boolean; result?: ValidationResult; error?: string }>;
type ProcessState = { active: string[]; cached: string[] };

function LogsModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [info, setInfo] = useState<ServerLogsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs(name, 100)
      .then(setInfo)
      .catch(() => setInfo({ name, lines: [], path: '' }))
      .finally(() => setLoading(false));
  }, [name]);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="font-semibold text-sm">{name} — logs</span>
          <div className="flex items-center gap-3">
            {info?.path && (
              <code className="text-xs text-gray-500 font-mono">{info.path}</code>
            )}
            <button
              onClick={load}
              className="text-xs text-gray-400 hover:text-gray-200 underline"
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 p-4">
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : !info || info.lines.length === 0 ? (
            <p className="text-gray-500 text-sm">No log entries found.</p>
          ) : (
            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
              {info.lines.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  refreshKey?: number;
}

export function ActiveServersMonitor({ refreshKey }: Props) {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthMap>({});
  const [processState, setProcessState] = useState<ProcessState>({ active: [], cached: [] });
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState<Record<string, boolean>>({});
  const [pausing, setPausing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchServers().then((json) =>
        Object.entries(json).map(([name, config]: [string, any]) => ({
          id: name,
          name,
          command: `${config.command} ${config.args ? config.args.join(' ') : ''}`.trim(),
          kind: config.kind,
        }))
      ),
      fetchSystem().then((s) => s.configPath ?? null),
    ])
      .then(([serverList, path]) => {
        setServers(serverList);
        setConfigPath(path);
        setError(null);
      })
      .catch(() => setError('Failed to load active servers'))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const pollProcessState = useCallback(() => {
    return fetchActiveServers().then(setProcessState).catch(() => {});
  }, []);

  useEffect(() => {
    pollProcessState();
    const timer = setInterval(pollProcessState, 5000);
    return () => clearInterval(timer);
  }, [pollProcessState]);

  const runCheck = async (name: string) => {
    setHealth((h) => ({ ...h, [name]: { loading: true } }));
    try {
      const result = await validateServer({ name });
      setHealth((h) => ({ ...h, [name]: { loading: false, result } }));
    } catch (e: any) {
      setHealth((h) => ({ ...h, [name]: { loading: false, error: e?.message ?? String(e) } }));
    }
  };

  const handleStop = async (name: string) => {
    setPausing((s) => ({ ...s, [name]: true }));
    try {
      await stopServer(name);
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (!msg.toLowerCase().includes('not running')) {
        alert('Pause failed: ' + msg);
        setPausing((s) => ({ ...s, [name]: false }));
        return;
      }
    }
    await pollProcessState();
    setPausing((s) => ({ ...s, [name]: false }));
  };

  const handleUninstall = async (id: string) => {
    if (!window.confirm(`¿Eliminar "${id}" de mcp-core?`)) return;
    try {
      await uninstall({ name: id });
      window.location.reload();
    } catch (e: any) {
      alert('Uninstall failed: ' + (e?.message ?? e));
    }
  };

  const handleCopyPath = () => {
    if (!configPath) return;
    navigator.clipboard.writeText(configPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const getProcessStatus = (name: string) => {
    if (processState.active.includes(name))
      return { dot: 'bg-green-500', label: 'running', tooltip: 'Proceso activo en el daemon.' };
    if (processState.cached.includes(name))
      return { dot: 'bg-yellow-500', label: 'cached', tooltip: 'Herramientas en caché, proceso no iniciado todavía.' };
    return {
      dot: 'bg-gray-500',
      label: 'idle',
      tooltip: 'Inactivo — el daemon lo iniciará automáticamente cuando un cliente solicite sus herramientas.',
    };
  };

  const renderHealth = (name: string) => {
    const h = health[name];
    if (!h) {
      return (
        <button
          onClick={() => runCheck(name)}
          title="Lanza el proceso del servidor, realiza el handshake MCP y cuenta las herramientas disponibles. Úsalo para confirmar que el servidor responde correctamente."
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
      const open = toolsOpen[name] ?? false;
      return (
        <div className="text-xs">
          <button
            onClick={() => setToolsOpen((s) => ({ ...s, [name]: !open }))}
            className="text-emerald-400 hover:text-emerald-300"
            title={`${h.result.latencyMs}ms`}
          >
            🟢 {h.result.tools} tools {open ? '▴' : '▾'}
          </button>
          {open && h.result.toolNames && h.result.toolNames.length > 0 && (
            <ul className="mt-1 ml-1 space-y-0.5 max-h-40 overflow-y-auto">
              {h.result.toolNames.map((t) => (
                <li key={t} className="font-mono text-[11px] text-gray-400">{t}</li>
              ))}
            </ul>
          )}
        </div>
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
      {logsFor && <LogsModal name={logsFor} onClose={() => setLogsFor(null)} />}

      <div className="flex items-baseline justify-between mb-4 border-b border-gray-800 pb-2">
        <h2 className="text-xl font-bold">Active MCP Servers</h2>
        {configPath && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Config:</span>
            <code className="text-xs text-gray-400 font-mono">{configPath}</code>
            <button
              onClick={handleCopyPath}
              title="Copiar ruta del config"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {copied ? '✓' : '⎘'}
            </button>
          </div>
        )}
      </div>
      <div className="bg-gray-800 rounded-lg shadow border border-gray-700 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Server</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider" title="Comando que usa el daemon para arrancar este servidor MCP">Running from</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Health</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {servers.map((server) => (
              <tr key={server.id} className="hover:bg-gray-750">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {(() => {
                      const s = getProcessStatus(server.name);
                      return (
                        <span title={s.tooltip} className="flex items-center gap-2 mr-3">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                          <span className="text-xs text-gray-500">{s.label}</span>
                        </span>
                      );
                    })()}
                    <span className="font-semibold">{server.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="font-mono text-sm bg-gray-900 px-2 py-1 rounded text-gray-300 break-all block">
                    {server.command}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {renderHealth(server.name)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-2">
                    {processState.active.includes(server.name) && (
                      <button
                        onClick={() => handleStop(server.name)}
                        disabled={pausing[server.name]}
                        title="Pausa el proceso del servidor. Vuelve a estado idle y se relanzará automáticamente en la siguiente petición."
                        className="inline-flex items-center px-2.5 py-1 rounded border border-yellow-500/40 text-xs font-medium text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {pausing[server.name] ? 'Pausing…' : 'Pause'}
                      </button>
                    )}
                    <button
                      onClick={() => runCheck(server.id)}
                      title="Lanza el proceso del servidor, realiza el handshake MCP y cuenta las herramientas disponibles."
                      className="inline-flex items-center px-2.5 py-1 rounded border border-blue-500/40 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
                    >
                      Re-validate
                    </button>
                    <button
                      onClick={() => setLogsFor(server.name)}
                      title="Ver las últimas líneas del log de stderr de este servidor."
                      className="inline-flex items-center px-2.5 py-1 rounded border border-gray-600 text-xs font-medium text-gray-400 hover:bg-gray-700 transition-colors"
                    >
                      Logs
                    </button>
                    <button
                      onClick={() => handleUninstall(server.id)}
                      title={
                        server.kind === 'system'
                          ? 'Elimina la entrada de mcp-core. El binario del sistema (Homebrew, etc.) no se toca.'
                          : 'Elimina el servidor de mcp-core y borra el paquete de ~/.mcp-core/servers/.'
                      }
                      className="inline-flex items-center px-2.5 py-1 rounded border border-red-500/40 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Uninstall
                    </button>
                  </div>
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
