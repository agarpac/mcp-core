import { useState, useEffect } from 'react';
import { openEventStream, type ProgressEvent } from '../api/client';

const PHASE_LABEL: Record<string, string> = {
  resolve: 'Resolving source',
  clone: 'Cloning repository',
  'npm-install': 'Installing dependencies',
  'npm-build': 'Building',
  register: 'Registering in mcp-core',
  'inject-clients': 'Injecting into AI clients',
  validate: 'Validating MCP handshake',
  done: 'Done',
  error: 'Error',
};

export function Progress({ active }: { active: boolean }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);

  useEffect(() => {
    if (!active) return;
    const source = openEventStream((event) => {
      setEvents((prev) => [...prev, event]);
    });
    return () => {
      source.close();
    };
  }, [active]);

  if (!active || events.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Progress</h3>
      <ul className="space-y-1">
        {events.map((e, i) => {
          const isError = e.phase === 'error';
          const isDone = e.phase === 'done';
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                className={
                  isError
                    ? 'text-red-400'
                    : isDone
                      ? 'text-emerald-400'
                      : 'text-blue-400'
                }
              >
                {isError ? '✗' : isDone ? '✓' : '•'}
              </span>
              <span className="text-gray-300">{PHASE_LABEL[e.phase] ?? e.phase}</span>
              {e.message && (
                <span className="text-gray-500 text-xs truncate" title={e.message}>
                  {e.message}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
