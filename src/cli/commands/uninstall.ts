import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { ConfigStore } from '../../config/store';
import { SERVERS_DIR, LOGS_DIR } from '../../config/paths';
import { notifyDaemon } from '../../daemon/notify';

export async function runUninstall(name: string) {
  ConfigStore.initialize();
  const state = ConfigStore.get();
  const cfg = state.servers[name];

  if (!cfg) {
    throw new Error(`El servidor '${name}' no está registrado en mcp-core.`);
  }

  console.log(`🗑️ Eliminando servidor MCP: ${name}`);

  ConfigStore.removeServer(name);
  console.log(`✅ Registro central eliminado.`);

  if (cfg.pkgName) {
    // npm-installed: remove from the shared node_modules via npm uninstall
    const { execa } = await import('execa');
    await execa('npm', ['uninstall', cfg.pkgName], { cwd: SERVERS_DIR });
    console.log(`✅ Paquete npm eliminado (${cfg.pkgName}).`);
  } else {
    // git/local-installed: remove the per-server directory
    const repoDir = path.join(SERVERS_DIR, name);
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
      console.log(`✅ Archivos locales eliminados (${repoDir}).`);
    }
  }

  const logFile = path.join(LOGS_DIR, `${name}.log`);
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  // Notify the daemon so it removes the backend from its cache and broadcasts
  // backends_changed to all connected gateway shims. Best-effort.
  await notifyDaemon({ type: 'backend_unregistered', name });

  console.log(`\n🎉 Desinstalación completada.`);
}

export function addUninstallCommand(program: Command) {
  program
    .command('uninstall <name>')
    .description('Desinstala un servidor MCP del core y lo elimina de todos los clientes')
    .action(async (name) => {
      try {
        await runUninstall(name);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });
}
