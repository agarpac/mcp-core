import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SystemPanel } from './components/SystemPanel';
import { AdvancedInstaller } from './components/AdvancedInstaller';
import { ActiveServersMonitor } from './components/ActiveServersMonitor';
function App() {
    return (_jsx("div", { className: "min-h-screen bg-gray-950 text-gray-200 p-8 font-sans", children: _jsxs("div", { className: "max-w-6xl mx-auto space-y-8", children: [_jsxs("header", { className: "mb-10", children: [_jsx("h1", { className: "text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2", children: "MCP Core Dashboard" }), _jsx("p", { className: "text-gray-400", children: "Gateway MCP \u2014 all backends, one entry per client" })] }), _jsx(SystemPanel, {}), _jsx(AdvancedInstaller, {}), _jsx(ActiveServersMonitor, {})] }) }));
}
export default App;
//# sourceMappingURL=App.js.map