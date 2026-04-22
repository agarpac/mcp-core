#!/usr/bin/env node
import { Command } from 'commander';
import { addInitCommand } from './commands/init';
import { addInstallCommand } from './commands/install';
import { addUninstallCommand } from './commands/uninstall';
import { addUiCommand } from './commands/ui';
import { addStatusCommand } from './commands/status';
import { addDaemonCommands } from './commands/daemon';
import { addMigrateCommand } from './commands/migrate';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json') as { version: string };

export function createCLI(): Command {
  const program = new Command();

  program
    .name('mcp-core')
    .description('CLI para Model Context Protocol Core Daemon')
    .version(version);

  addInitCommand(program);
  addInstallCommand(program);
  addUninstallCommand(program);
  addUiCommand(program);
  addStatusCommand(program);
  addDaemonCommands(program);
  addMigrateCommand(program);

  return program;
}

if (require.main === module) {
  createCLI().parse(process.argv);
}
