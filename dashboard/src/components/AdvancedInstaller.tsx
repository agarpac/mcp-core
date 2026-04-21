import { useState } from 'react';
import { install } from '../api/client';
import { Progress } from './Progress';

export function AdvancedInstaller() {
  const [source, setSource] = useState('');
  const [method, setMethod] = useState<'auto' | 'npm' | 'uvx' | 'git' | 'local'>('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ name: string; tools?: number } | null>(null);

  const handleInstall = async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    setLastResult(null);
    try {
      const res: any = await install({ source, ...(method !== 'auto' ? { method } : {}) } as any);
      setLastResult({
        name: res.name,
        tools: res.validation?.tools,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-white mb-4">Advanced Installer</h2>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Source</label>
          <input
            type="text"
            placeholder="NPM package / Git URL / Python (uvx) package"
            className="w-full bg-gray-900 border border-gray-600 rounded-md px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Installation Method</label>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded-md px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
          >
            <option value="auto">Auto</option>
            <option value="npm">NPM</option>
            <option value="uvx">uvx (Python)</option>
            <option value="git">Git</option>
            <option value="local">Local</option>
          </select>
        </div>
        <button
          onClick={handleInstall}
          disabled={loading}
          className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-2 px-4 rounded-md transition-colors"
        >
          {loading ? 'Installing...' : 'Install Server'}
        </button>

        <Progress active={loading} />

        {lastResult && (
          <div className="bg-emerald-900/40 border border-emerald-700 rounded p-3 text-sm text-emerald-200">
            Installed <strong>{lastResult.name}</strong>
            {lastResult.tools !== undefined && ` — ${lastResult.tools} tools exposed`}
          </div>
        )}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-200 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
