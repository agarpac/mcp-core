"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const commander_1 = require("commander");
const index_1 = require("../../src/cli/index");
(0, vitest_1.describe)('createCLI', () => {
    (0, vitest_1.it)('returns a commander Command instance', () => {
        const program = (0, index_1.createCLI)();
        (0, vitest_1.expect)(program).toBeInstanceOf(commander_1.Command);
    });
    (0, vitest_1.it)('exposes the expected metadata', () => {
        const program = (0, index_1.createCLI)();
        (0, vitest_1.expect)(program.name()).toBe('mcp-core');
        (0, vitest_1.expect)(program.version()).toBe('1.0.0');
    });
    vitest_1.it.each(['init', 'install', 'uninstall', 'ui'])('registers the "%s" subcommand', (cmdName) => {
        const program = (0, index_1.createCLI)();
        const registered = program.commands.map((c) => c.name());
        (0, vitest_1.expect)(registered).toContain(cmdName);
    });
    (0, vitest_1.it)('does not auto-parse argv at module load', () => {
        // If createCLI() parsed argv internally, requiring the module in tests
        // would crash or print help. Reaching this point proves it did not.
        (0, vitest_1.expect)(() => (0, index_1.createCLI)()).not.toThrow();
    });
});
//# sourceMappingURL=index.test.js.map