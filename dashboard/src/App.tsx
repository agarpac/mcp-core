import { SystemPanel } from './components/SystemPanel';
import { AdvancedInstaller } from './components/AdvancedInstaller';
import { ActiveServersMonitor } from './components/ActiveServersMonitor';

function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="mb-10">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">
            MCP Core Dashboard
          </h1>
          <p className="text-gray-400">Gateway MCP — all backends, one entry per client</p>
        </header>

        <SystemPanel />
        <AdvancedInstaller />
        <ActiveServersMonitor />
      </div>
    </div>
  );
}

export default App;
