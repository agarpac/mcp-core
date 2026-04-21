# mcp-core ⚡️
**Gateway MCP — un único punto de entrada para todos tus servidores**

`mcp-core` es un **gateway MCP**: registra una sola entrada en cada cliente de IA (Cursor, Claude Desktop, VS Code…) y expone todos los backends que gestionas internamente, con prefijo. Tus herramientas aparecen como `memory__store`, `filesystem__read`, `mcp_core__install_server`, etc.

Resultado: una instancia compartida por todos los clientes, sin duplicar procesos ni configuraciones.

---

## ⚡ Quick Start

```bash
# 1) Bootstrap: inyecta la entrada del gateway en todos los clientes detectados
#    y migra los MCPs que ya tengas configurados
npx mcp-core init

# Detecta las entradas legacy, las importa al registro central y reemplaza todo por la única entrada del gateway. Un backup `.backup` se crea antes de sobreescribir.

# 2) Instala un servidor MCP — disponible en todos los clientes al instante
npx mcp-core install @modelcontextprotocol/server-memory
```

El daemon se arranca solo y queda vivo en segundo plano. No es necesario reiniciar el cliente si éste soporta `tools/list_changed`.

¿Lo quieres permanente?

```bash
npm i -g mcp-core
mcp-core status
```

---

## 🏗️ Arquitectura

```
 Cursor           Claude Desktop       VS Code
   │ stdio             │ stdio            │ stdio
   ▼                   ▼                  ▼
mcp-core-mcp       mcp-core-mcp       mcp-core-mcp   ← gateway shim (1 por cliente)
   │                   │                  │
   │         UNIX socket                  │
   ▼                   ▼                  ▼
┌────────────────────────────────────────────────┐
│              mcp-daemon (1 proceso)            │
│  ┌─────────────┐  ┌────────────────┐           │
│  │server-memory│  │server-filesyst.│  …        │
│  └─────────────┘  └────────────────┘           │
└────────────────────────────────────────────────┘
```

- **Gateway shim (`mcp-core-mcp`)**: binario MCP ligero. Se conecta al daemon, suscribe a cambios de backends y reexpone todas las tools/resources/prompts con prefijo (`<backend>__<name>`). Arranca el daemon si no está vivo.
- **Daemon**: supervisa y multiplexa backends MCP. Notifica a todos los shims cuando se instala o desinstala un servidor — los clientes que soportan `list_changed` reciben las nuevas tools sin reiniciar.
- **CLI (`mcp-core`)**: instalar, desinstalar, listar, inicializar y lanzar el dashboard.

### Prefijado de capabilities

| Capability | Prefijo | Ejemplo |
|---|---|---|
| Tools | `<backend>__<name>` | `memory__store`, `mcp_core__list_servers` |
| Resources | URI `mcp-core://<backend>/<uri>` | `mcp-core://filesystem/file:///foo` |
| Prompts | `<backend>__<name>` | `github__create_issue` |

Las 5 tools de control del gateway viven bajo el prefijo `mcp_core__`: `install_server`, `uninstall_server`, `list_servers`, `toggle_client`, `get_daemon_status`.

---

## 💻 Clientes soportados

`mcp-core init` detecta e inyecta la entrada del gateway automáticamente en:

| Cliente | Path (macOS) | Path (Linux) | Clave raíz |
|---|---|---|---|
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` |
| **VS Code / Copilot** | `~/Library/Application Support/Code/User/mcp.json` | `~/.config/Code/User/mcp.json` | `servers` |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` | — | `mcpServers` |
| **Claude Code** | `./.mcp.json` (project) | `./.mcp.json` (project) | `mcpServers` |
| **OpenCode** | `~/.config/opencode/opencode.json` | `~/.config/opencode/opencode.json` | `mcp` |

> **Windows**: fuera del alcance actual.

---

## 🛠️ Comandos (CLI)

```bash
# Bootstrap del gateway: inyecta mcp-core en todos los clientes y migra entradas legacy
mcp-core init [--clients cursor,claudeCode]

# Instalar un servidor MCP
mcp-core install <npm-pkg | git-url | uvx-pkg> [opciones]
  --name <alias>         alias del servidor
  --env KEY=value        variable de entorno (repetible)
  --method auto|npm|uvx|git   método de instalación (por defecto: auto)
  --no-validate          saltarse el handshake MCP de verificación

# Desinstalar un servidor
mcp-core uninstall <server-name>

# Estado: daemon, servidores registrados, runtimes
mcp-core status

# Comandos del daemon
mcp-core daemon stop
mcp-core daemon restart
mcp-core daemon logs [server-name] [-f] [-n <N>]

# Dashboard web local
mcp-core ui
```

### Validación post-install

Tras instalar, `mcp-core install` hace el handshake MCP completo y reporta herramientas y latencia:

```text
✅ Installed server-memory
   Validated: 3 tools (142ms)
```

### Environment variables

```bash
mcp-core install @modelcontextprotocol/server-github \
  --env GITHUB_TOKEN=ghp_xxx
```

### Soporte uvx (Python)

`--method uvx` fuerza el runner; `auto` lo detecta para paquetes con prefijo `mcp-server-`:

```bash
mcp-core install mcp-server-postgres --env DATABASE_URL=postgres://localhost/mydb
```

---

## 🎨 Web Dashboard

`mcp-core ui` levanta un Express en loopback con token aleatorio. Funcionalidades:

- **System Panel** — OS, Node, estado del daemon y grid de runtimes detectados.
- **Advanced Installer** — instalar con stream SSE de progreso en tiempo real.
- **Active MCP Servers** — lista de backends registrados con health check por handshake.

La UI está endurecida contra DNS rebinding: bind a `127.0.0.1`, validación de `Host:`, CORS whitelist, token Bearer obligatorio.

### Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/system` | Estado del sistema y runtimes |
| GET | `/api/servers` | Servidores registrados |
| GET | `/api/daemon/status` | Ping al daemon + PID |
| GET | `/api/events` | SSE stream de progreso |
| POST | `/api/install` | `{ source, name?, env?, method?, validate? }` |
| POST | `/api/uninstall` | `{ name }` |
| POST | `/api/validate` | `{ name }` → `{ success, tools, latencyMs }` |

---

## 📂 Directorios

```text
~/.mcp-core/
├── config.json     # Registro central de servidores MCP
├── daemon.sock     # UNIX socket gateway ↔ daemon
├── daemon.pid      # PID lock
├── logs/           # Logs por servidor
└── servers/        # Repositorios instalados localmente
```

---

## 🧪 Desarrollo

```bash
git clone <repo> && cd mcp-core
npm run setup       # install + build + npm link
npx vitest run      # Suite completa
```

`npm run setup` deja los dos binarios (`mcp-core`, `mcp-core-mcp`) disponibles en el PATH.

## Licencia
MIT
