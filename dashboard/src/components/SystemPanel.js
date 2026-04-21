import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { fetchSystem } from '../api/client';
export function SystemPanel() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
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
        return (_jsx("div", { className: "bg-gray-800 text-white p-4 rounded-lg flex shadow-md mb-6 border border-gray-700", children: "Loading system status..." }));
    }
    if (error) {
        return (_jsx("div", { className: "bg-red-900 text-white p-4 rounded-lg flex shadow-md mb-6 border border-red-700", children: error }));
    }
    if (!data)
        return null;
    const runtimes = data.runtimes ?? {};
    const runtimeEntries = Object.values(runtimes);
    return (_jsxs("div", { className: "bg-gray-800 text-white p-4 rounded-lg shadow-md mb-6 border border-gray-700", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { className: "flex gap-6", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-400 text-sm block", children: "OS" }), _jsx("span", { className: "font-semibold", children: data.os })] }), data.arch && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-400 text-sm block", children: "Architecture" }), _jsx("span", { className: "font-semibold", children: data.arch })] })), data.node && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-400 text-sm block", children: "Node.js" }), _jsx("span", { className: "font-semibold", children: data.node })] }))] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-400 text-sm block", children: "Daemon Status" }), _jsx("span", { className: `font-semibold ${data.daemonActive ? 'text-green-400' : 'text-red-400'}`, children: data.daemonActive ? 'Active' : 'Inactive' })] })] }), runtimeEntries.length > 0 && (_jsxs("div", { className: "mt-4 pt-4 border-t border-gray-700", children: [_jsx("span", { className: "text-gray-400 text-sm block mb-2", children: "Runtimes" }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2", children: runtimeEntries.map((r) => (_jsxs("div", { className: `px-3 py-2 rounded border text-xs ${r.available
                                ? 'border-emerald-700 bg-emerald-900/30 text-emerald-200'
                                : 'border-gray-700 bg-gray-900 text-gray-500'}`, title: r.path ?? 'not available', children: [_jsx("div", { className: "font-semibold", children: r.name }), _jsx("div", { className: "text-[10px]", children: r.available ? r.version ?? '—' : 'missing' })] }, r.name))) })] }))] }));
}
//# sourceMappingURL=SystemPanel.js.map