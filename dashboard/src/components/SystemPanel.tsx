import { useState, useEffect } from 'react';
import { fetchSystem, type SystemInfo } from '../api/client';

export function SystemPanel() {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSystem()
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch(() => setError('Failed to load system status'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-800 text-white p-4 rounded-lg flex shadow-md mb-6 border border-gray-700">
        Loading system status...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900 text-white p-4 rounded-lg flex shadow-md mb-6 border border-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const runtimes = data.runtimes ?? {};
  const runtimeEntries = Object.values(runtimes);

  return (
    <div className="bg-gray-800 text-white p-4 rounded-lg shadow-md mb-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-6">
          <div>
            <span className="text-gray-400 text-sm block">OS</span>
            <span className="font-semibold">{data.os}</span>
          </div>
          {data.arch && (
            <div>
              <span className="text-gray-400 text-sm block">Architecture</span>
              <span className="font-semibold">{data.arch}</span>
            </div>
          )}
          {data.node && (
            <div>
              <span className="text-gray-400 text-sm block">Node.js</span>
              <span className="font-semibold">{data.node}</span>
            </div>
          )}
        </div>
        <div>
          <span className="text-gray-400 text-sm block">Daemon Status</span>
          <span className={`font-semibold ${data.daemonActive ? 'text-green-400' : 'text-red-400'}`}>
            {data.daemonActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {runtimeEntries.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <span className="text-gray-400 text-sm block mb-2">Runtimes</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {runtimeEntries.map((r) => (
              <div
                key={r.name}
                className={`px-3 py-2 rounded border text-xs ${
                  r.available
                    ? 'border-emerald-700 bg-emerald-900/30 text-emerald-200'
                    : 'border-gray-700 bg-gray-900 text-gray-500'
                }`}
                title={r.path ?? 'not available'}
              >
                <div className="font-semibold">{r.name}</div>
                <div className="text-[10px]">{r.available ? r.version ?? '—' : 'missing'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
