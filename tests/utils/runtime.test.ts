import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa BEFORE importing the module under test.
// Use vi.hoisted so the mock fn exists when vi.mock hoists to the top of the file.
const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));
vi.mock('execa', () => ({
  execa: execaMock,
}));

import {
  detectRuntimes,
  detectSome,
  installHintFor,
  type RuntimeInfo,
} from '../../src/utils/runtime';

/**
 * Helper: make a default implementation that, for every `<bin> --version`
 * returns a plausible stdout, and for every `which <bin>` returns a path.
 * Individual tests override for specific bins to simulate failures.
 */
function wireDefaultHappyPath() {
  execaMock.mockImplementation(async (cmd: string, args: string[]) => {
    // `which <bin>` -> return a fake path
    if (cmd === 'which') {
      const bin = args[0];
      return { stdout: `/usr/local/bin/${bin}`, stderr: '', exitCode: 0 } as any;
    }
    // `<bin> --version`
    if (args && args[0] === '--version') {
      const versionByBin: Record<string, string> = {
        node: 'v20.10.0',
        npm: '10.2.3',
        npx: '10.2.3',
        uvx: 'uvx 0.4.18 (abc123 2024-09-01)',
        python: 'Python 3.11.6',
        python3: 'Python 3.11.6',
        git: 'git version 2.43.0',
      };
      const stdout = versionByBin[cmd] ?? '0.0.0';
      return { stdout, stderr: '', exitCode: 0 } as any;
    }
    return { stdout: '', stderr: '', exitCode: 0 } as any;
  });
}

describe('runtime detection — detectRuntimes', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('returns a RuntimeReport with an entry for every known runtime', async () => {
    wireDefaultHappyPath();

    const report = await detectRuntimes();

    const expectedNames: RuntimeInfo['name'][] = [
      'node',
      'npm',
      'npx',
      'uvx',
      'python',
      'python3',
      'git',
    ];
    for (const name of expectedNames) {
      expect(report.runtimes[name]).toBeDefined();
      expect(report.runtimes[name].name).toBe(name);
    }
  });

  it('parses node version as "v20.10.0" and marks available', async () => {
    wireDefaultHappyPath();

    const report = await detectRuntimes();

    expect(report.runtimes.node.available).toBe(true);
    expect(report.runtimes.node.version).toBe('v20.10.0');
    expect(report.runtimes.node.path).toBe('/usr/local/bin/node');
  });

  it('parses a bare numeric version (npm "10.2.3") including the v prefix normalization', async () => {
    wireDefaultHappyPath();

    const report = await detectRuntimes();

    expect(report.runtimes.npm.available).toBe(true);
    // We accept either "10.2.3" or "v10.2.3" — what matters is the semver is captured.
    expect(report.runtimes.npm.version).toMatch(/v?10\.2\.3/);
  });

  it('parses uvx verbose output and captures the semver', async () => {
    wireDefaultHappyPath();

    const report = await detectRuntimes();

    expect(report.runtimes.uvx.available).toBe(true);
    expect(report.runtimes.uvx.version).toMatch(/v?0\.4\.18/);
  });

  it('marks a runtime as unavailable when the binary errors (ENOENT)', async () => {
    // All succeed except node, which throws ENOENT
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'node' || (cmd === 'which' && args[0] === 'node')) {
        const err: NodeJS.ErrnoException = new Error('spawn node ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      if (cmd === 'which') {
        return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 } as any;
      }
      if (args && args[0] === '--version') {
        return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const report = await detectRuntimes();

    expect(report.runtimes.node.available).toBe(false);
    expect(report.runtimes.node.version).toBeNull();
    expect(report.runtimes.node.path).toBeNull();
  });

  it('marks a runtime as unavailable when `which` reports no path (exitCode != 0)', async () => {
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'uvx') {
        return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
      }
      if (cmd === 'which') {
        return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'uvx') {
        const err: NodeJS.ErrnoException = new Error('spawn uvx ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      if (args && args[0] === '--version') {
        return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const report = await detectRuntimes();

    expect(report.runtimes.uvx.available).toBe(false);
  });

  it('builds the `missing` list with every unavailable runtime name', async () => {
    // Make node and python3 unavailable; rest OK.
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      const unavailable = new Set(['node', 'python3']);
      if (cmd === 'which' && unavailable.has(args[0] ?? '')) {
        return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
      }
      if (cmd === 'which') {
        return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 } as any;
      }
      if (unavailable.has(cmd)) {
        const err: NodeJS.ErrnoException = new Error(`spawn ${cmd} ENOENT`);
        err.code = 'ENOENT';
        throw err;
      }
      if (args && args[0] === '--version') {
        return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const report = await detectRuntimes();

    expect(report.missing).toEqual(expect.arrayContaining(['node', 'python3']));
    expect(report.missing).not.toContain('npm');
    expect(report.missing).not.toContain('git');
  });

  it('runs all detections in parallel (single synchronous burst of execa calls)', async () => {
    // Resolve only after we have observed that all `--version` calls were
    // scheduled before any of them resolved. We do that by counting the number
    // of `--version` calls scheduled before the first resolution.
    let pendingAtFirstResolve = 0;
    let resolved = 0;

    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') {
        return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 } as any;
      }
      if (args && args[0] === '--version') {
        // Allow the event loop to schedule all other calls first.
        await new Promise((r) => setImmediate(r));
        if (resolved === 0) {
          // Count how many version calls have been scheduled up to now.
          pendingAtFirstResolve = execaMock.mock.calls.filter(
            (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === '--version'
          ).length;
        }
        resolved++;
        return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    await detectRuntimes();

    // Parallelism check: by the time the first --version resolves, every
    // runtime's --version call has already been scheduled.
    expect(pendingAtFirstResolve).toBe(7);
  });
});

describe('runtime detection — detectSome', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('returns only the requested runtimes, in the requested order', async () => {
    wireDefaultHappyPath();

    const infos = await detectSome(['uvx', 'git']);

    expect(infos).toHaveLength(2);
    expect(infos[0]!.name).toBe('uvx');
    expect(infos[1]!.name).toBe('git');
    expect(infos[0]!.available).toBe(true);
    expect(infos[1]!.available).toBe(true);
  });

  it('reports unavailable runtimes with null version/path', async () => {
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'uvx') {
        return { stdout: '', stderr: 'not found', exitCode: 1 } as any;
      }
      if (cmd === 'uvx') {
        const err: NodeJS.ErrnoException = new Error('spawn uvx ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      if (cmd === 'which') {
        return { stdout: `/usr/local/bin/${args[0]}`, stderr: '', exitCode: 0 } as any;
      }
      if (args && args[0] === '--version') {
        return { stdout: `${cmd} 1.2.3`, stderr: '', exitCode: 0 } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });

    const [uvx] = await detectSome(['uvx']);

    expect(uvx!.available).toBe(false);
    expect(uvx!.version).toBeNull();
    expect(uvx!.path).toBeNull();
  });
});

describe('runtime detection — installHintFor', () => {
  it('returns a non-empty hint for uvx with the astral.sh script', () => {
    const hint = installHintFor('uvx');
    expect(hint).not.toBeNull();
    expect(hint!.length).toBeGreaterThan(0);
    expect(hint!).toContain('astral.sh');
  });

  it('returns a hint for node mentioning nodejs.org', () => {
    const hint = installHintFor('node');
    expect(hint).not.toBeNull();
    expect(hint!).toContain('nodejs.org');
  });

  it('returns a hint for python3 mentioning python.org', () => {
    const hint = installHintFor('python3');
    expect(hint).not.toBeNull();
    expect(hint!).toContain('python.org');
  });

  it('returns a hint for git mentioning git-scm.com', () => {
    const hint = installHintFor('git');
    expect(hint).not.toBeNull();
    expect(hint!).toContain('git-scm.com');
  });

  it('returns a hint for npm/npx referring back to Node.js', () => {
    expect(installHintFor('npm')).toMatch(/Node\.js/i);
    expect(installHintFor('npx')).toMatch(/Node\.js/i);
  });
});
