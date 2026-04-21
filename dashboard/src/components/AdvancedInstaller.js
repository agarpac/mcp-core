import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { install } from '../api/client';
import { Progress } from './Progress';
export function AdvancedInstaller() {
    const [source, setSource] = useState('');
    const [method, setMethod] = useState('auto');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastResult, setLastResult] = useState(null);
    const handleInstall = async () => {
        if (!source)
            return;
        setLoading(true);
        setError(null);
        setLastResult(null);
        try {
            const res = await install({ source, ...(method !== 'auto' ? { method } : {}) });
            setLastResult({
                name: res.name,
                tools: res.validation?.tools,
            });
        }
        catch (e) {
            setError(e?.message ?? String(e));
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs("div", { className: "bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6", children: [_jsx("h2", { className: "text-xl font-bold text-white mb-4", children: "Advanced Installer" }), _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-300 mb-1", children: "Source" }), _jsx("input", { type: "text", placeholder: "NPM package / Git URL / Python (uvx) package", className: "w-full bg-gray-900 border border-gray-600 rounded-md px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500", value: source, onChange: (e) => setSource(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-300 mb-1", children: "Installation Method" }), _jsxs("select", { className: "w-full bg-gray-900 border border-gray-600 rounded-md px-4 py-2 text-white focus:outline-none focus:border-blue-500", value: method, onChange: (e) => setMethod(e.target.value), children: [_jsx("option", { value: "auto", children: "Auto" }), _jsx("option", { value: "npm", children: "NPM" }), _jsx("option", { value: "uvx", children: "uvx (Python)" }), _jsx("option", { value: "git", children: "Git" }), _jsx("option", { value: "local", children: "Local" })] })] }), _jsx("button", { onClick: handleInstall, disabled: loading, className: "mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-2 px-4 rounded-md transition-colors", children: loading ? 'Installing...' : 'Install Server' }), _jsx(Progress, { active: loading }), lastResult && (_jsxs("div", { className: "bg-emerald-900/40 border border-emerald-700 rounded p-3 text-sm text-emerald-200", children: ["Installed ", _jsx("strong", { children: lastResult.name }), lastResult.tools !== undefined && ` — ${lastResult.tools} tools exposed`] })), error && (_jsx("div", { className: "bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-200 whitespace-pre-wrap", children: error }))] })] }));
}
//# sourceMappingURL=AdvancedInstaller.js.map