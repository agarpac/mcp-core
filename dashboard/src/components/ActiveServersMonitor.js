import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { fetchServers, uninstall, validateServer } from '../api/client';
export function ActiveServersMonitor() {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [health, setHealth] = useState({});
    useEffect(() => {
        fetchServers()
            .then((json) => {
            const serverList = Object.entries(json).map(([name, config]) => ({
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
    const runCheck = async (name) => {
        setHealth((h) => ({ ...h, [name]: { loading: true } }));
        try {
            const result = await validateServer({ name });
            setHealth((h) => ({ ...h, [name]: { loading: false, result } }));
        }
        catch (e) {
            setHealth((h) => ({ ...h, [name]: { loading: false, error: e?.message ?? String(e) } }));
        }
    };
    const handleUninstall = async (id) => {
        try {
            await uninstall({ name: id });
            window.location.reload();
        }
        catch (e) {
            alert('Uninstall failed: ' + (e?.message ?? e));
        }
    };
    const renderHealth = (name) => {
        const h = health[name];
        if (!h) {
            return (_jsx("button", { onClick: () => runCheck(name), className: "text-xs text-gray-400 hover:text-blue-400 underline", children: "Check" }));
        }
        if (h.loading)
            return _jsx("span", { className: "text-xs text-gray-400", children: "Checking\u2026" });
        if (h.error)
            return _jsx("span", { className: "text-xs text-red-400", title: h.error, children: "Error" });
        if (!h.result)
            return null;
        if (h.result.success) {
            return (_jsxs("span", { className: "text-xs text-emerald-400", title: `${h.result.latencyMs}ms`, children: ["\uD83D\uDFE2 ", h.result.tools, " tools"] }));
        }
        return (_jsxs("span", { className: "text-xs text-red-400", title: h.result.error ?? 'unknown', children: ["\uD83D\uDD34 ", h.result.error ?? 'failed'] }));
    };
    if (loading)
        return _jsx("div", { className: "p-4 text-gray-300", children: "Loading active servers..." });
    if (error)
        return _jsx("div", { className: "p-4 text-red-400", children: error });
    return (_jsxs("section", { className: "mb-8", children: [_jsx("h2", { className: "text-xl font-bold mb-4 border-b border-gray-800 pb-2", children: "Active MCP Servers" }), _jsx("div", { className: "bg-gray-800 rounded-lg shadow border border-gray-700 overflow-hidden", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-700", children: [_jsx("thead", { className: "bg-gray-900", children: _jsxs("tr", { children: [_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider", children: "Server" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider", children: "Command" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider", children: "Health" }), _jsx("th", { className: "px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider", children: "Actions" })] }) }), _jsxs("tbody", { className: "divide-y divide-gray-700", children: [servers.map((server) => (_jsxs("tr", { className: "hover:bg-gray-750", children: [_jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "w-2 h-2 rounded-full bg-green-500 mr-3" }), _jsx("span", { className: "font-semibold", children: server.name })] }) }), _jsx("td", { className: "px-6 py-4", children: _jsx("span", { className: "font-mono text-sm bg-gray-900 px-2 py-1 rounded text-gray-300 truncate block max-w-xs", title: server.command, children: server.command }) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: renderHealth(server.name) }), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-right text-sm font-medium", children: [_jsx("button", { onClick: () => runCheck(server.id), className: "text-blue-400 hover:text-blue-300 mx-2", children: "Re-validate" }), _jsx("button", { onClick: () => handleUninstall(server.id), className: "text-red-400 hover:text-red-300 mx-2", children: "Uninstall" })] })] }, server.id))), servers.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 4, className: "px-6 py-8 text-center text-gray-500", children: "No MCP servers currently installed." }) }))] })] }) })] }));
}
//# sourceMappingURL=ActiveServersMonitor.js.map