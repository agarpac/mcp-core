import { Command } from 'commander';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import process from 'process';
import fs from 'fs';
import { ConfigStore } from '../../config/store';
import { DAEMON_SOCKET, CLIENT_PATHS, getClientConfigPath } from '../../config/paths';
import { runInstall } from './install';
import { runUninstall } from './uninstall';
import { toggleClientServer } from '../injectors/index';
import { getDaemonStatus } from './status';
import { detectRuntimes } from '../../utils/runtime';
import { validateMcpServer } from '../../validate/handshake';
import { getProgressBus } from '../../utils/progress-singleton';

export interface CreateAppOptions {
  token: string;
  port?: number;
  staticDir?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function extractToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const q = req.query?.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

function hostOf(req: Request): string {
  if (req.hostname) return req.hostname;
  const h = req.headers.host;
  if (typeof h !== 'string') return '';
  return h.split(':')[0] ?? '';
}

export function createApp(options: CreateAppOptions) {
  const { token, port = 3939, staticDir } = options;

  if (!token) {
    throw new Error('createApp requires a non-empty token');
  }

  const app = express();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = hostOf(req);
    if (!LOOPBACK_HOSTS.has(host)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }
    return next();
  });

  app.use(
    cors({
      origin: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    })
  );

  app.use(express.json());

  const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const supplied = extractToken(req);
    if (!supplied || supplied !== token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };
  app.use('/api', authMiddleware);

  app.get('/api/system', async (_req, res) => {
    const daemonActive = fs.existsSync(DAEMON_SOCKET);
    let runtimes: unknown = null;
    try {
      const report = await detectRuntimes();
      runtimes = report.runtimes;
    } catch {
      runtimes = null;
    }
    res.json({
      os: process.platform,
      arch: process.arch,
      node: process.version,
      daemonActive,
      runtimes,
    });
  });

  app.get('/api/servers', (_req, res) => {
    try {
      const config = ConfigStore.get();
      res.json(config.servers || {});
    } catch {
      res.status(500).json({ error: 'Failed to read servers config' });
    }
  });

  app.get('/api/clients', (_req, res) => {
    const clients = Object.keys(CLIENT_PATHS).map((key) => {
      const clientName = key as keyof typeof CLIENT_PATHS;
      const configPath = getClientConfigPath(clientName);
      let exists = false;
      if (configPath) exists = fs.existsSync(configPath);
      return {
        name: clientName,
        configPath: configPath || 'Unsupported Platform',
        status: exists ? 'Installed' : 'Not Installed',
        enabled: exists,
      };
    });
    res.json(clients);
  });

  app.post('/api/install', async (req, res) => {
    try {
      const { source, name, env, method, clients, validate } = req.body ?? {};
      if (!source) return res.status(400).json({ error: 'Source is required' });
      const result = await runInstall(source, name, env, {
        method,
        clients,
        ...(validate === false ? { validate: false } : {}),
      });
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/uninstall', async (req, res) => {
    try {
      const { name } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'Name is required' });
      await runUninstall(name);
      res.json({ success: true, message: `Server ${name} uninstalled` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/toggle-client', (req, res) => {
    try {
      const { serverName, clientName, enable } = req.body ?? {};
      if (!serverName || !clientName || typeof enable !== 'boolean') {
        return res.status(400).json({ error: 'Invalid parameters' });
      }
      toggleClientServer(serverName, clientName, enable);
      res.json({ success: true, message: `Toggled ${serverName} in ${clientName} to ${enable}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Validate a registered server by handshake.
  app.post('/api/validate', async (req, res) => {
    try {
      const { name } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const cfg = ConfigStore.get().servers[name];
      if (!cfg) return res.status(404).json({ error: `Server ${name} not registered` });
      const result = await validateMcpServer({
        command: cfg.command,
        args: cfg.args,
        ...(cfg.env ? { env: cfg.env } : {}),
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/daemon/status', async (_req, res) => {
    try {
      const status = await getDaemonStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Server-Sent Events: stream progress events from the shared bus.
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const bus = getProgressBus();
    const unsubscribe = bus.on((event) => {
      res.write(`event: progress\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat every 15s to keep proxies happy.
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}

export function addUiCommand(program: Command) {
  program
    .command('ui')
    .description('Start the local MCP Core Dashboard API')
    .action(() => {
      const PORT = 3939;
      const token = crypto.randomBytes(32).toString('hex');
      const candidate = path.resolve(__dirname, '..', '..', '..', 'dashboard', 'dist');
      const staticDir = fs.existsSync(candidate) ? candidate : undefined;

      const app = createApp({ token, port: PORT, ...(staticDir ? { staticDir } : {}) });
      app.listen(PORT, '127.0.0.1', () => {
        const url = `http://127.0.0.1:${PORT}/?token=${token}`;
        console.log(`MCP Core UI running — open ${url}`);
        console.log(`(bound to 127.0.0.1 only; token required for /api requests)`);
      });
    });
}
