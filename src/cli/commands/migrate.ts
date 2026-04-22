import { Command } from 'commander';
import { ConfigStore } from '../../config/store';
import { SERVERS_DIR } from '../../config/paths';
import { runInstall } from './install';

/**
 * Detects the npm package name from a command/args pair that references
 * an external node_modules directory (e.g. migrated from another client).
 */
function extractNpmPkg(command: string, args: string[]): string | null {
  const MARKER = 'node_modules/';
  for (const candidate of [command, ...args]) {
    const idx = candidate.lastIndexOf(MARKER);
    if (idx === -1) continue;
    const after = candidate.slice(idx + MARKER.length);
    const parts = after.split('/');
    if (parts[0]?.startsWith('@') && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    if (parts[0]) return parts[0];
  }
  return null;
}

function isManagedByMcpCore(command: string, args: string[]): boolean {
  return [command, ...args].some((p) => p.startsWith(SERVERS_DIR));
}

export interface MigrateCandidate {
  name: string;
  pkg: string;
  env?: Record<string, string>;
}

export interface MigrateReport {
  candidates: MigrateCandidate[];
  skipped: Array<{ name: string; reason: string }>;
}

export function planMigration(): MigrateReport {
  ConfigStore.initialize();
  const state = ConfigStore.get();

  const candidates: MigrateCandidate[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const [name, cfg] of Object.entries(state.servers)) {
    if (cfg.pkgName) {
      skipped.push({ name, reason: 'already managed (pkgName set)' });
      continue;
    }
    if (isManagedByMcpCore(cfg.command, cfg.args)) {
      skipped.push({ name, reason: 'already in ~/.mcp-core/servers/' });
      continue;
    }
    const pkg = extractNpmPkg(cfg.command, cfg.args);
    if (!pkg) {
      skipped.push({ name, reason: 'not an npm package (system binary or local path)' });
      continue;
    }
    candidates.push({ name, pkg, ...(cfg.env ? { env: cfg.env } : {}) });
  }

  return { candidates, skipped };
}

export async function runMigrate(opts: { dryRun?: boolean } = {}): Promise<void> {
  const { candidates, skipped } = planMigration();

  if (candidates.length === 0) {
    console.log('✅ All servers are already managed by mcp-core. Nothing to migrate.');
    if (skipped.length > 0) {
      console.log('\nSkipped:');
      for (const { name, reason } of skipped) {
        console.log(`  ${name.padEnd(18)}  (${reason})`);
      }
    }
    return;
  }

  console.log('\nServers to migrate to ~/.mcp-core/servers/:\n');
  for (const { name, pkg } of candidates) {
    console.log(`  ${name.padEnd(18)}  npm install ${pkg}`);
  }

  if (skipped.length > 0) {
    console.log('\nSkipped:\n');
    for (const { name, reason } of skipped) {
      console.log(`  ${name.padEnd(18)}  (${reason})`);
    }
  }

  if (opts.dryRun) {
    console.log('\n(dry run — no changes made)');
    return;
  }

  console.log('');
  let ok = 0;
  let failed = 0;

  for (const { name, pkg, env } of candidates) {
    console.log(`\n📦 Migrating ${name} (${pkg})...`);
    try {
      await runInstall(pkg, name, env, { method: 'npm', validate: false });
      console.log(`  ✅ ${name} migrated`);
      ok++;
    } catch (err: any) {
      console.error(`  ❌ Failed to migrate ${name}: ${err?.message ?? err}`);
      failed++;
    }
  }

  console.log(`\n🎉 Migration complete. ${ok} migrated, ${failed} failed.`);
}

export function addMigrateCommand(program: Command) {
  program
    .command('migrate')
    .description('Reinstall legacy servers (migrated from other clients) into ~/.mcp-core/servers/')
    .option('--dry-run', 'Show what would be migrated without making changes')
    .action(async (options) => {
      try {
        await runMigrate({ dryRun: options.dryRun });
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });
}
