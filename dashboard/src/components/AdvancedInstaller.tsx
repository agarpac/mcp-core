import { useState } from 'react';
import { install } from '../api/client';
import { Progress } from './Progress';

interface EnvEntry {
  key: string;
  value: string;
}

interface Props {
  onInstallSuccess?: () => void;
}

export function AdvancedInstaller({ onInstallSuccess }: Props) {
  const [source, setSource] = useState('');
  const [method, setMethod] = useState<'auto' | 'npm' | 'uvx' | 'git' | 'local'>('auto');
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ name: string; tools?: number } | null>(null);

  const addEnvEntry = () => setEnvEntries((prev) => [...prev, { key: '', value: '' }]);

  const removeEnvEntry = (index: number) =>
    setEnvEntries((prev) => prev.filter((_, i) => i !== index));

  const updateEnvEntry = (index: number, field: 'key' | 'value', val: string) =>
    setEnvEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: val } : e)));

  const buildEnvMap = (): Record<string, string> | undefined => {
    const entries = envEntries.filter((e) => e.key.trim() !== '');
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries.map((e) => [e.key.trim(), e.value]));
  };

  const handleInstall = async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    setLastResult(null);
    try {
      const env = buildEnvMap();
      const res: any = await install({
        source,
        ...(method !== 'auto' ? { method } : {}),
        ...(env ? { env } : {}),
      });
      setLastResult({
        name: res.name,
        tools: res.validation?.tools,
      });
      onInstallSuccess?.();
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

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">
              Environment Variables
            </label>
            <button
              type="button"
              onClick={addEnvEntry}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              + Add variable
            </button>
          </div>
          {envEntries.length === 0 ? (
            <p className="text-xs text-gray-500">No environment variables. Click "Add variable" to add one.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {envEntries.map((entry, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="KEY"
                    className="w-2/5 bg-gray-900 border border-gray-600 rounded-md px-3 py-1.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 font-mono"
                    value={entry.key}
                    onChange={(e) => updateEnvEntry(i, 'key', e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="value"
                    className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-3 py-1.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500"
                    value={entry.value}
                    onChange={(e) => updateEnvEntry(i, 'value', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvEntry(i)}
                    className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
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
