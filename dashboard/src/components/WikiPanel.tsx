import { useState } from 'react';

interface Entry {
  q: string;
  a: React.ReactNode;
}

const ENTRIES: Entry[] = [
  {
    q: '¿Qué es mcp-core y para qué sirve?',
    a: (
      <p>
        mcp-core es un <strong>gateway MCP</strong>: un único servidor que Claude Code, Cursor, VS Code y
        otros clientes configuran una sola vez. Desde ahí, gestiona todos tus servidores MCP de forma
        centralizada — los instala, los arranca bajo demanda y los expone como si fueran herramientas
        nativas del cliente.
      </p>
    ),
  },
  {
    q: '¿Qué es el daemon?',
    a: (
      <div className="space-y-2">
        <p>
          Proceso en segundo plano que actúa como gestor de procesos MCP. Cuando un cliente pide una
          herramienta, el daemon arranca el servidor correspondiente si no estaba en marcha, hace el
          handshake y devuelve el resultado. Si nadie lo usa durante un tiempo, el proceso se para solo
          para no consumir recursos.
        </p>
        <p>
          <strong>No necesitas arrancarlo manualmente.</strong> El gateway (<code>mcp-core-mcp</code>) lo
          lanza automáticamente en background la primera vez que un cliente hace una llamada de
          herramienta. <code>mcp-core daemon start</code> existe solo si quieres pre-calentarlo antes de
          usar el dashboard.
        </p>
      </div>
    ),
  },
  {
    q: 'Estados: idle / cached / running',
    a: (
      <ul className="space-y-1.5">
        <li><span className="inline-block w-2 h-2 rounded-full bg-gray-500 mr-2 align-middle" /><strong>idle</strong> — el servidor está registrado pero su proceso no existe. El daemon lo arrancará en cuanto llegue una petición de herramienta.</li>
        <li><span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-2 align-middle" /><strong>cached</strong> — las herramientas están en memoria pero el proceso no está activo todavía. La primera llamada real lo iniciará.</li>
        <li><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2 align-middle" /><strong>running</strong> — el proceso está vivo y puede responder llamadas de herramienta de inmediato.</li>
      </ul>
    ),
  },
  {
    q: '¿Qué hace el botón Pause?',
    a: (
      <p>
        Envía una señal <code>SIGTERM</code> al proceso del servidor y lo elimina del registro de activos del
        daemon. El servidor vuelve a estado <strong>idle</strong>: no consume CPU ni memoria. La próxima vez
        que un cliente llame a cualquiera de sus herramientas, el daemon lo relanzará automáticamente — sin
        que tengas que hacer nada.
      </p>
    ),
  },
  {
    q: '¿Qué significa "gateway active" en el panel de clientes?',
    a: (
      <p>
        Indica que ese cliente tiene <code>mcp-core</code> configurado como servidor MCP en su archivo de
        configuración. El cliente le pasa todas las llamadas de herramienta al gateway, que las enruta al
        daemon. Si ves <em>not configured</em>, ejecuta <code>mcp-core init</code> para inyectar la
        entrada automáticamente.
      </p>
    ),
  },
  {
    q: 'Diferencia entre kind: system y kind: npm al desinstalar',
    a: (
      <ul className="space-y-1.5">
        <li><strong>npm</strong> — el servidor fue instalado por mcp-core en <code>~/.mcp-core/servers/node_modules/</code>. Al desinstalar, se borra el paquete del disco además de la entrada de configuración.</li>
        <li><strong>system</strong> — el binario proviene de Homebrew, pip u otro gestor externo. Al desinstalar, mcp-core solo elimina su entrada de configuración; el binario no se toca.</li>
      </ul>
    ),
  },
  {
    q: 'Cómo instalar un servidor nuevo desde el formulario',
    a: (
      <div className="space-y-3">
        <p>
          El campo <strong>Source</strong> acepta cualquiera de estas formas:
        </p>
        <ul className="space-y-1.5">
          <li><code>@scope/paquete</code> o <code>paquete</code> — paquete npm (ej. <code>@upstash/context7-mcp</code>)</li>
          <li><code>https://github.com/org/repo</code> — repositorio Git</li>
          <li><code>paquete-uvx</code> con método <em>uvx</em> — paquete Python vía <code>uvx</code></li>
          <li>ruta absoluta con método <em>local</em> — binario ya instalado en tu máquina</li>
        </ul>
        <p>
          El campo <strong>Method</strong> controla cómo se instala:
        </p>
        <ul className="space-y-1.5">
          <li><strong>Auto</strong> — mcp-core detecta el tipo por el formato del source (recomendado).</li>
          <li><strong>NPM</strong> — fuerza instalación vía <code>npm install</code> en <code>~/.mcp-core/servers/</code>.</li>
          <li><strong>uvx</strong> — para paquetes Python; usa <code>uvx</code> para ejecutarlos sin instalación permanente.</li>
          <li><strong>Git</strong> — clona el repositorio y ejecuta desde el directorio clonado.</li>
          <li><strong>Local</strong> — apunta a un binario o script ya existente en tu disco.</li>
        </ul>
        <p>
          Tras pulsar <em>Install Server</em>, mcp-core descarga el paquete, hace el handshake MCP para
          verificar que responde y muestra cuántas herramientas expone. Equivale a ejecutar{' '}
          <code>mcp-core install &lt;source&gt;</code> desde la terminal.
        </p>
      </div>
    ),
  },
];

function WikiEntry({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-700 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-200 hover:text-white hover:bg-gray-700/40 transition-colors"
      >
        <span>{entry.q}</span>
        <span className="ml-4 flex-shrink-0 text-gray-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-gray-400 leading-relaxed [&_code]:bg-gray-900 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-gray-300 [&_ul]:list-none [&_strong]:text-gray-200">
          {entry.a}
        </div>
      )}
    </div>
  );
}

export function WikiPanel() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-8">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xl font-bold mb-4 border-b border-gray-800 pb-2 w-full text-left hover:text-gray-300 transition-colors"
      >
        <span>How it works</span>
        <span className="text-gray-500 text-base ml-1">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          {ENTRIES.map((e) => (
            <WikiEntry key={e.q} entry={e} />
          ))}
        </div>
      )}
    </section>
  );
}
