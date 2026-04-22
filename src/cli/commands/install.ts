import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { ConfigStore, type McpServerKind } from '../../config/store';
import { SERVERS_DIR } from '../../config/paths';
import { getProgressBus } from '../../utils/progress-singleton';
import { decorateError } from '../../utils/hints';
import { validateMcpServer, type ValidationResult } from '../../validate/handshake';
import { notifyDaemon } from '../../daemon/notify';

export type InstallMethod = 'auto' | 'npm' | 'uvx' | 'git' | 'local';

export interface InstallOptions {
  method?: InstallMethod;
  clients?: string[];
  validate?: boolean;
  validateTimeoutMs?: number;
}

export interface InstallResult {
  name: string;
  command: string;
  args: string[];
  validation?: ValidationResult;
}

const PYTHON_PATTERNS: RegExp[] = [
  /^mcp-server-/i,
  /^uv:/i,
];

function detectMethod(source: string, explicit?: InstallMethod): InstallMethod {
  if (explicit && explicit !== 'auto') return explicit;
  if (source.endsWith('.git') || source.startsWith('git+') || /^https?:\/\/.*\.git$/.test(source)) return 'git';
  if (source.startsWith('http://') || source.startsWith('https://')) return 'git';
  if (source.startsWith('./') || source.startsWith('/') || source.startsWith('~')) return 'local';
  if (PYTHON_PATTERNS.some((p) => p.test(source))) return 'uvx';
  return 'npm';
}

export async function runInstall(
  source: string,
  name?: string,
  env?: Record<string, string>,
  opts: InstallOptions = {}
): Promise<InstallResult> {
  const bus = getProgressBus();
  const method = detectMethod(source, opts.method);

  try {
    bus.emit('resolve', `resolving ${source} as ${method}`, { source, method });

    ConfigStore.initialize();
    const { execa } = await import('execa');

    let serverName = name;
    let command = '';
    let args: string[] = [];

    if (method === 'git') {
      serverName = serverName || path.basename(source, '.git');
      const repoDir = path.join(SERVERS_DIR, serverName);
      if (fs.existsSync(repoDir)) {
        throw new Error(`exists`);
      }
      bus.emit('clone', `cloning ${source}`);
      await execa('git', ['clone', source, repoDir], { stdio: 'inherit' });
      bus.emit('npm-install', 'running npm install');
      await execa('npm', ['install'], { cwd: repoDir, stdio: 'inherit' });
      try {
        bus.emit('npm-build', 'running npm run build');
        await execa('npm', ['run', 'build'], { cwd: repoDir, stdio: 'inherit' });
      } catch {}
      command = 'node';
      args = [path.join(repoDir, 'build', 'index.js')];
    } else if (method === 'uvx') {
      serverName = serverName || source.split('/').pop() || source;
      command = 'uvx';
      args = ['-y', source];
    } else if (method === 'local') {
      serverName = serverName || path.basename(source);
      command = 'node';
      args = [source];
    } else {
      // npm: all packages share a single node_modules in SERVERS_DIR
      serverName = serverName || source.split('/').pop() || source;
      fs.mkdirSync(SERVERS_DIR, { recursive: true });

      // Bootstrap a package.json so npm install is deterministic
      const rootPkg = path.join(SERVERS_DIR, 'package.json');
      if (!fs.existsSync(rootPkg)) {
        fs.writeFileSync(rootPkg, JSON.stringify({ private: true, dependencies: {} }, null, 2));
      }

      bus.emit('npm-install', `npm install ${source}`);
      await execa('npm', ['install', source], { cwd: SERVERS_DIR });

      // Resolve entry point from the installed package's manifest
      const pkgDir = path.join(SERVERS_DIR, 'node_modules', source);
      const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) as Record<string, unknown>;

      let entry: string;
      if (pkgJson['bin']) {
        const bin = pkgJson['bin'];
        const rel = typeof bin === 'string' ? bin : (Object.values(bin as Record<string, string>)[0] ?? 'index.js');
        entry = path.join(pkgDir, rel);
      } else if (typeof pkgJson['main'] === 'string') {
        entry = path.join(pkgDir, pkgJson['main'] as string);
      } else {
        entry = path.join(pkgDir, 'index.js');
      }

      command = 'node';
      args = [entry];
    }

    bus.emit('register', `registering ${serverName} in mcp-core`);
    const KIND_MAP: Record<Exclude<InstallMethod, 'auto'>, McpServerKind> = {
      npm: 'npm', uvx: 'uvx', git: 'git', local: 'local',
    };
    ConfigStore.addServer(serverName, {
      command,
      args,
      ...(env ? { env } : {}),
      ...(method === 'npm' ? { pkgName: source } : {}),
      kind: KIND_MAP[method as Exclude<InstallMethod, 'auto'>] ?? 'npm',
    });

    const shouldValidate = opts.validate !== false;
    let validation: ValidationResult | undefined;
    if (shouldValidate) {
      bus.emit('validate', `validating ${serverName} via MCP handshake`);
      validation = await validateMcpServer({
        command,
        args,
        ...(env ? { env } : {}),
        ...(opts.validateTimeoutMs !== undefined ? { timeoutMs: opts.validateTimeoutMs } : {}),
      });
    }

    // Notify the daemon so it can update its capability cache and broadcast
    // backends_changed to all connected gateway shims. Best-effort: the daemon
    // may not be running and the install still succeeds.
    await notifyDaemon({
      type: 'backend_registered',
      name: serverName,
      capabilities: {
        tools: validation?.toolDefinitions ?? [],
        resources: [],
        prompts: [],
      },
    });

    bus.emit('done', `installed ${serverName}`, { name: serverName, validation });

    return {
      name: serverName,
      command,
      args,
      ...(validation ? { validation } : {}),
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    bus.emit('error', decorateError(message));
    throw err;
  }
}

/** Parse `--env KEY=value` flags into a record. */
function collectEnv(value: string, acc: Record<string, string>): Record<string, string> {
  const idx = value.indexOf('=');
  if (idx === -1) throw new Error(`--env expects KEY=value, got: ${value}`);
  const key = value.slice(0, idx);
  const val = value.slice(idx + 1);
  return { ...acc, [key]: val };
}

function collectList(value: string, acc: string[]): string[] {
  return [...acc, ...value.split(',').map((s) => s.trim()).filter(Boolean)];
}

export function addInstallCommand(program: Command) {
  program
    .command('install <source>')
    .description('Install an MCP server (npm package, git URL, uvx Python package, or local path)')
    .option('-n, --name <name>', 'Alias for the installed server')
    .option('--env <KEY=value>', 'Environment variable (repeatable)', collectEnv, {} as Record<string, string>)
    .option('--method <method>', 'Install method: auto | npm | uvx | git | local', 'auto')
    .option('--clients <ids>', 'Comma-separated client ids (repeatable)', collectList, [] as string[])
    .option('--no-validate', 'Skip MCP handshake validation after install')
    .action(async (source, options) => {
      try {
        const res = await runInstall(source, options.name, options.env, {
          method: options.method as InstallMethod,
          clients: (options.clients as string[]).length > 0 ? options.clients : undefined,
          validate: options.validate !== false,
        });
        console.log(`\n✅ Installed ${res.name}`);
        if (res.validation) {
          if (res.validation.success) {
            console.log(`   Validated: ${res.validation.tools} tools (${res.validation.latencyMs}ms)`);
          } else {
            console.log(`   ⚠️ Validation failed: ${res.validation.error}`);
          }
        }
      } catch (err: any) {
        console.error(decorateError(err?.message ?? String(err)));
        process.exit(1);
      }
    });
}
