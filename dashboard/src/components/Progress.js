import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { openEventStream } from '../api/client';
const PHASE_LABEL = {
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
export function Progress({ active }) {
    const [events, setEvents] = useState([]);
    useEffect(() => {
        if (!active)
            return;
        const source = openEventStream((event) => {
            setEvents((prev) => [...prev, event]);
        });
        return () => {
            source.close();
        };
    }, [active]);
    if (!active || events.length === 0)
        return null;
    return (_jsxs("div", { className: "bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4", children: [_jsx("h3", { className: "text-sm font-semibold text-gray-300 mb-3", children: "Progress" }), _jsx("ul", { className: "space-y-1", children: events.map((e, i) => {
                    const isError = e.phase === 'error';
                    const isDone = e.phase === 'done';
                    return (_jsxs("li", { className: "flex items-start gap-2 text-sm", children: [_jsx("span", { className: isError
                                    ? 'text-red-400'
                                    : isDone
                                        ? 'text-emerald-400'
                                        : 'text-blue-400', children: isError ? '✗' : isDone ? '✓' : '•' }), _jsx("span", { className: "text-gray-300", children: PHASE_LABEL[e.phase] ?? e.phase }), e.message && (_jsx("span", { className: "text-gray-500 text-xs truncate", title: e.message, children: e.message }))] }, i));
                }) })] }));
}
//# sourceMappingURL=Progress.js.map