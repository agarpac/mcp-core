"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock execa BEFORE importing the module under test.
// Use vi.hoisted so the mock fn exists when vi.mock hoists to the top of the file.
const { execaMock } = vitest_1.vi.hoisted(() => ({
    execaMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('execa', () => ({
    execa: execaMock,
}));
const runtime_1 = require("../../src/utils/runtime");
/**
 * Helper: make a default implementation that, for every `<bin> --version`
 * returns a plausible stdout, and for every `which <bin>` returns a path.
 * Individual tests override for specific bins to simulate failures.
 */
function wireDefaultHappyPath() {
    execaMock.mockImplementation(async (cmd, args) => {
        // `which <bin>` -> return a fake path
        if (cmd === 'which') {
            const bin = args[0];
            return { stdout: `/usr/local/bin/${bin}`, stderr: '', exitCode: 0 };
        }
        // `<bin> --version`
        if (args && args[0] === '--version') {
            const versionByBin = {
                node: 'v20.10.0',
                npm: '10.2.3',
                npx: '10.2.3',
                uvx: 'uvx 0.4.18 (abc123 2024-09-01)',
                python: 'Python 3.11.6',
                python3: 'Python 3.11.6',
                git: 'git version 2.43.0',
            };
            const stdout = versionByBin[cmd] ?? '0.0.0';
            return { stdout, stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
    });
}
(0, vitest_1.describe)('runtime detection — detectRuntimes', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockReset();
    });
    (0, vitest_1.it)('returns a RuntimeReport with an entry for every known runtime', async () => {
        wireDefaultHappyPath();
        const report = await (0, runtime_1.detectRuntimes)();
        const expectedNames = [
            'node',
            'npm',
            'npx',
            'uvx',
            'python',
            'python3',
            'git',
        ];
        for (const name of expectedNames) {
            (0, vitest_1.expect)(report.runtimes[name]).toBeDefined();
            (0, vitest_1.expect)(report.runtimes[name].name).toBe(name);
        }
    });
    (0, vitest_1.it)('parses node version as "v20.10.0" and marks available', async () => {
        wireDefaultHappyPath();
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.runtimes.node.available).toBe(true);
        (0, vitest_1.expect)(report.runtimes.node.version).toBe('v20.10.0');
        (0, vitest_1.expect)(report.runtimes.node.path).toBe('/usr/local/bin/node');
    });
    (0, vitest_1.it)('parses a bare numeric version (npm "10.2.3") including the v prefix normalization', async () => {
        wireDefaultHappyPath();
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.runtimes.npm.available).toBe(true);
        // We accept either "10.2.3" or "v10.2.3" — what matters is the semver is captured.
        (0, vitest_1.expect)(report.runtimes.npm.version).toMatch(/v?10\.2\.3/);
    });
    (0, vitest_1.it)('parses uvx verbose output and captures the semver', async () => {
        wireDefaultHappyPath();
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.runtimes.uvx.available).toBe(true);
        (0, vitest_1.expect)(report.runtimes.uvx.version).toMatch(/v?0\.4\.18/);
    });
    (0, vitest_1.it)('marks a runtime as unavailable when the binary errors (ENOENT)', async () => {
        // All succeed except node, which throws ENOENT
        execaMock.mockImplementation(async (cmd, args) => {
            if (cmd === 'node' || (cmd === 'which' && args[0] === 'node')) {
                const err = new Error('spawn node ENOENT');
                err.code = 'ENOENT';
                throw err;
            }
            if (cmd === 'which') {
                return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 };
            }
            if (args && args[0] === '--version') {
                return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.runtimes.node.available).toBe(false);
        (0, vitest_1.expect)(report.runtimes.node.version).toBeNull();
        (0, vitest_1.expect)(report.runtimes.node.path).toBeNull();
    });
    (0, vitest_1.it)('marks a runtime as unavailable when `which` reports no path (exitCode != 0)', async () => {
        execaMock.mockImplementation(async (cmd, args) => {
            if (cmd === 'which' && args[0] === 'uvx') {
                return { stdout: '', stderr: 'not found', exitCode: 1 };
            }
            if (cmd === 'which') {
                return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 };
            }
            if (cmd === 'uvx') {
                const err = new Error('spawn uvx ENOENT');
                err.code = 'ENOENT';
                throw err;
            }
            if (args && args[0] === '--version') {
                return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.runtimes.uvx.available).toBe(false);
    });
    (0, vitest_1.it)('builds the `missing` list with every unavailable runtime name', async () => {
        // Make node and python3 unavailable; rest OK.
        execaMock.mockImplementation(async (cmd, args) => {
            const unavailable = new Set(['node', 'python3']);
            if (cmd === 'which' && unavailable.has(args[0] ?? '')) {
                return { stdout: '', stderr: 'not found', exitCode: 1 };
            }
            if (cmd === 'which') {
                return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 };
            }
            if (unavailable.has(cmd)) {
                const err = new Error(`spawn ${cmd} ENOENT`);
                err.code = 'ENOENT';
                throw err;
            }
            if (args && args[0] === '--version') {
                return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        const report = await (0, runtime_1.detectRuntimes)();
        (0, vitest_1.expect)(report.missing).toEqual(vitest_1.expect.arrayContaining(['node', 'python3']));
        (0, vitest_1.expect)(report.missing).not.toContain('npm');
        (0, vitest_1.expect)(report.missing).not.toContain('git');
    });
    (0, vitest_1.it)('runs all detections in parallel (single synchronous burst of execa calls)', async () => {
        // Resolve only after we have observed that all `--version` calls were
        // scheduled before any of them resolved. We do that by counting the number
        // of `--version` calls scheduled before the first resolution.
        let pendingAtFirstResolve = 0;
        let resolved = 0;
        execaMock.mockImplementation(async (cmd, args) => {
            if (cmd === 'which') {
                return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 };
            }
            if (args && args[0] === '--version') {
                // Allow the event loop to schedule all other calls first.
                await new Promise((r) => setImmediate(r));
                if (resolved === 0) {
                    // Count how many version calls have been scheduled up to now.
                    pendingAtFirstResolve = execaMock.mock.calls.filter((c) => Array.isArray(c[1]) && c[1][0] === '--version').length;
                }
                resolved++;
                return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        await (0, runtime_1.detectRuntimes)();
        // Parallelism check: by the time the first --version resolves, every
        // runtime's --version call has already been scheduled.
        (0, vitest_1.expect)(pendingAtFirstResolve).toBe(7);
    });
});
(0, vitest_1.describe)('runtime detection — detectSome', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockReset();
    });
    (0, vitest_1.it)('returns only the requested runtimes, in the requested order', async () => {
        wireDefaultHappyPath();
        const infos = await (0, runtime_1.detectSome)(['uvx', 'git']);
        (0, vitest_1.expect)(infos).toHaveLength(2);
        (0, vitest_1.expect)(infos[0].name).toBe('uvx');
        (0, vitest_1.expect)(infos[1].name).toBe('git');
        (0, vitest_1.expect)(infos[0].available).toBe(true);
        (0, vitest_1.expect)(infos[1].available).toBe(true);
    });
    (0, vitest_1.it)('reports unavailable runtimes with null version/path', async () => {
        execaMock.mockImplementation(async (cmd, args) => {
            if (cmd === 'which' && args[0] === 'uvx') {
                return { stdout: '', stderr: 'not found', exitCode: 1 };
            }
            if (cmd === 'uvx') {
                const err = new Error('spawn uvx ENOENT');
                err.code = 'ENOENT';
                throw err;
            }
            if (cmd === 'which') {
                return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 };
            }
            if (args && args[0] === '--version') {
                return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        const [uvx] = await (0, runtime_1.detectSome)(['uvx']);
        (0, vitest_1.expect)(uvx.available).toBe(false);
        (0, vitest_1.expect)(uvx.version).toBeNull();
        (0, vitest_1.expect)(uvx.path).toBeNull();
    });
});
(0, vitest_1.describe)('runtime detection — installHintFor', () => {
    (0, vitest_1.it)('returns a non-empty hint for uvx with the astral.sh script', () => {
        const hint = (0, runtime_1.installHintFor)('uvx');
        (0, vitest_1.expect)(hint).not.toBeNull();
        (0, vitest_1.expect)(hint.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(hint).toContain('astral.sh');
    });
    (0, vitest_1.it)('returns a hint for node mentioning nodejs.org', () => {
        const hint = (0, runtime_1.installHintFor)('node');
        (0, vitest_1.expect)(hint).not.toBeNull();
        (0, vitest_1.expect)(hint).toContain('nodejs.org');
    });
    (0, vitest_1.it)('returns a hint for python3 mentioning python.org', () => {
        const hint = (0, runtime_1.installHintFor)('python3');
        (0, vitest_1.expect)(hint).not.toBeNull();
        (0, vitest_1.expect)(hint).toContain('python.org');
    });
    (0, vitest_1.it)('returns a hint for git mentioning git-scm.com', () => {
        const hint = (0, runtime_1.installHintFor)('git');
        (0, vitest_1.expect)(hint).not.toBeNull();
        (0, vitest_1.expect)(hint).toContain('git-scm.com');
    });
    (0, vitest_1.it)('returns a hint for npm/npx referring back to Node.js', () => {
        (0, vitest_1.expect)((0, runtime_1.installHintFor)('npm')).toMatch(/Node\.js/i);
        (0, vitest_1.expect)((0, runtime_1.installHintFor)('npx')).toMatch(/Node\.js/i);
    });
});
//# sourceMappingURL=runtime.test.js.map