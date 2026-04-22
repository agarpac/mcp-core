import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { createCLI } from '../../src/cli/index';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json') as { version: string };

describe('createCLI', () => {
  it('returns a commander Command instance', () => {
    const program = createCLI();
    expect(program).toBeInstanceOf(Command);
  });

  it('exposes the expected metadata', () => {
    const program = createCLI();
    expect(program.name()).toBe('mcp-core');
    expect(program.version()).toBe(version);
  });

  it.each(['init', 'install', 'uninstall', 'ui'])(
    'registers the "%s" subcommand',
    (cmdName) => {
      const program = createCLI();
      const registered = program.commands.map((c) => c.name());
      expect(registered).toContain(cmdName);
    }
  );

  it('does not auto-parse argv at module load', () => {
    // If createCLI() parsed argv internally, requiring the module in tests
    // would crash or print help. Reaching this point proves it did not.
    expect(() => createCLI()).not.toThrow();
  });
});
