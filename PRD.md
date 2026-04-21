# mcp-core: Centralized MCP Middleware

## 1. Resumen Ejecutivo
`mcp-core` es un middleware y gestor centralizado para servidores MCP (Model Context Protocol). Su objetivo es ejecutar una **única instancia de cada servidor MCP en segundo plano (daemon)** y permitir que múltiples clientes de IA se conecten a ella.

## 2. Problema a Resolver
Actualmente, cada cliente de IA gestiona sus propios servidores MCP. Si un desarrollador usa Cursor y OpenCode simultáneamente y ambos necesitan el servidor de memoria o Postgres, se levantan dos procesos independientes, causando:
* Consumo redundante de memoria y CPU.
* Desincronización de estado (ej. memoria y contextos).
* Conflictos de puertos en servidores locales.
* Experiencia de instalación fragmentada.

## 3. Solución y Arquitectura
* **mcp-daemon**: proceso Node.js en background que escucha en `~/.mcp-core/daemon.sock` (UNIX socket). Mantiene vivos los verdaderos servidores MCP y multiplexa las peticiones JSON-RPC reescribiendo temporalmente los `id` por `clientId` para evitar colisiones cuando varios clientes preguntan en paralelo. Mantiene un PID file (`~/.mcp-core/daemon.pid`) para impedir arranques duplicados y limpia sockets huérfanos en el siguiente arranque.
* **mcp-proxy**: binario CLI ligero que los clientes de IA ejecutan en lugar del servidor MCP real. Lee `stdin` del cliente, lo envía por el UNIX socket al daemon y devuelve la respuesta por `stdout`. Si el daemon no está vivo, lo arranca en background (`detached`) con retry de backoff exponencial.
* **mcp-cli (`mcp-core`)**: CLI para instalar, desinstalar, listar y auto-descubrir servidores MCP, así como lanzar el dashboard web.

### 3.1. Estado y persistencia
Directorio raíz: `~/.mcp-core/`
- `servers/` → repositorios y binarios de los servidores MCP instalados.
- `config.json` → registro central de servidores y clientes linkados.
- `daemon.sock` → UNIX socket para la comunicación Proxy ↔ Daemon.
- `daemon.pid` → lock de proceso único para el daemon.
- `logs/` → logs consolidados (stderr y stdout no-JSON) por servidor.

### 3.2. Arranque del daemon
Decisión consciente: **NO se configura autostart a nivel OS** (ni `launchd`, ni `systemd`, ni PM2). El daemon se levanta bajo demanda a partir de la primera llamada MCP del usuario: cuando un cliente IA ejecuta `mcp-proxy`, éste comprueba el socket y, si no responde, arranca el daemon como proceso `detached`. Motivos:
- Cero intrusividad en el sistema operativo del usuario.
- Si el usuario no abre ningún cliente IA, no gasta recursos.
- Simplifica el soporte multi-plataforma al no depender de servicios de SO.

### 3.3. Clientes Objetivo (Inyectores Auto-Config)
| Cliente | Path (darwin) | Path (linux) | Clave raíz |
|---|---|---|---|
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` |
| VS Code / Copilot | `~/Library/Application Support/Code/User/mcp.json` | `~/.config/Code/User/mcp.json` | `servers` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | — | `mcpServers` |
| Claude Code | `./.mcp.json` (project) | `./.mcp.json` (project) | `mcpServers` |
| OpenCode | `~/.config/opencode/opencode.json` | `~/.config/opencode/opencode.json` | `mcp` |

- **Windows**: fuera del alcance actual. El registry `CLIENT_ADAPTERS` está preparado para añadir rutas `win32` sin refactor.
- **OpenCode**: usa clave raíz `mcp` y serializa `command` como `array [cmd, ...args]` con campo `type`. El adaptador lo transforma transparentemente.
- **ChatGPT Desktop**: descartado de la inyección automática porque solo consume MCP vía HTTP remoto — no tiene archivo local de configuración.

### 3.4. Dashboard Web y API local
`mcp-core ui` levanta un servidor Express en loopback que sirve el SPA React (`dashboard/`) y expone una API REST. La API está endurecida contra DNS rebinding con las siguientes defensas en capas:

1. **Bind a `127.0.0.1`** (no `0.0.0.0`) — aísla la superficie al kernel local.
2. **Token aleatorio** (32 bytes hex) generado al arrancar. Todas las llamadas a `/api/*` requieren `Authorization: Bearer <token>` o `?token=...` (primera carga del SPA). La CLI imprime al arrancar una URL que incluye el token.
3. **Validación de `Host:` header** contra `127.0.0.1` / `localhost`. Un atacante que intente DNS rebinding hará que el navegador envíe un `Host` con su dominio → `403 Forbidden`.
4. **CORS whitelist** estricta: sólo `http://127.0.0.1:<port>` y `http://localhost:<port>` como orígenes permitidos.

Justificación de NO usar UNIX socket para la API: los navegadores no pueden conectar a sockets UNIX. La defensa correcta para una API consumida por un SPA local es la combinación de loopback + token + Host validation, patrón usado por Jupyter, React DevTools y Docker Desktop.

**Endpoints** (todos `/api`, todos requieren token):
* `GET /api/system` → Estado del sistema y del daemon.
* `GET /api/servers` → Servidores registrados en `mcp-core`.
* `GET /api/clients` → Clientes de IA detectados y su estado.
* `POST /api/install` → `{ source, name? }` — instala un nuevo servidor MCP.
* `POST /api/uninstall` → `{ name }` — desinstala un servidor.
* `POST /api/toggle-client` → `{ serverName, clientName, enable }` — activa / desactiva la inyección por cliente.

**Dashboard React (`dashboard/`)**: cuatro componentes modulares (`SystemPanel`, `ActiveServersMonitor`, `AdvancedInstaller`, `AiClientsGrid`) consumen la API a través de `dashboard/src/api/client.ts`, que gestiona el token (lo lee de la URL en el primer load, lo cachea en `sessionStorage`, y lo adjunta a cada `fetch` como Bearer).

### 3.5. Hardening de ejecución
* `install` / `uninstall` usan **`execa` con argumentos como array** (`['clone', source, repoDir]`) en lugar de interpolación de strings al shell → elimina el vector de command injection por URL maliciosa.
* Los injectores escriben siempre con backup `*.backup` antes de sobreescribir la config de un cliente.
* El daemon usa `signal 0` (kill con señal 0) para verificar liveness del PID del lock file — semántica POSIX estándar.

## 4. Casos de Uso
1. **Instalación de servidor**: `mcp-core install <url>`. Lo baja a `~/.mcp-core/servers`, lo registra en `config.json` y lo inyecta en todos los clientes soportados.
2. **Desinstalación**: `mcp-core uninstall <nombre>`. Borra los ficheros, el registro y limpia las configs de cada cliente.
3. **Auto-descubrimiento**: `mcp-core init`. Escanea Cursor, VS Code, Claude Desktop, Claude Code y OpenCode; para cada servidor MCP ya configurado fuera de `mcp-core`, lo migra al registro central y reescribe la config del cliente apuntando a `mcp-proxy`.
4. **Estado**: `mcp-core status`. Hace `ping` al daemon por el socket, lee el PID file, lista servidores registrados y clientes detectados.
5. **Petición concurrente**: Cursor pide la herramienta `read_memory` (id: 1) y OpenCode también (id: 1). `mcp-daemon` convierte esto en (id: `client-1-1`) e (id: `client-2-1`). El servidor MCP los procesa en paralelo, devuelve resultados y el daemon los enruta al cliente correcto recuperando su `id` original.

## 5. Testing
Cobertura actual (vitest):
- **Daemon**: multiplexing por `clientId`, handshake, ping/pong, PID locking (rechaza con PID vivo, limpia stale), cleanup de socket huérfano, auto-shutdown por timeout.
- **Proxy**: conexión al primer intento, retry con backoff exponencial, spawn fallback tras el primer backoff, rechazo tras agotar reintentos.
- **CLI**: registro correcto de comandos (`init`, `install`, `uninstall`, `ui`, `status`), sanitización de `execa` contra command injection, ping del daemon desde `status`.
- **Injectors**: serialización y mutación por cada adapter de cliente.
- **Dashboard**: componentes conectados al API client con token en `sessionStorage`, manejo de estado loading/error, POST a endpoints relativos.
