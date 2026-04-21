"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const daemon_1 = require("../../src/cli/commands/daemon");
(0, vitest_1.describe)('daemon stop/readDaemonPid', () => {
    let tmpDir;
    let pidFile;
    let socketPath;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-daemon-test-'));
        pidFile = path_1.default.join(tmpDir, 'daemon.pid');
        socketPath = path_1.default.join(tmpDir, 'daemon.sock');
    });
    (0, vitest_1.afterEach)(() => {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    });
    (0, vitest_1.it)('readDaemonPid returns null when pidfile missing', () => {
        (0, vitest_1.expect)((0, daemon_1.readDaemonPid)(pidFile)).toBeNull();
    });
    (0, vitest_1.it)('readDaemonPid returns the number when file exists with valid pid', () => {
        fs_1.default.writeFileSync(pidFile, '42');
        (0, vitest_1.expect)((0, daemon_1.readDaemonPid)(pidFile)).toBe(42);
    });
    (0, vitest_1.it)('readDaemonPid returns null when file has garbage', () => {
        fs_1.default.writeFileSync(pidFile, 'not-a-number');
        (0, vitest_1.expect)((0, daemon_1.readDaemonPid)(pidFile)).toBeNull();
    });
    (0, vitest_1.it)('stopDaemon reports not-running when no pidfile exists', async () => {
        const res = await (0, daemon_1.stopDaemon)({ pidFile, socketPath });
        (0, vitest_1.expect)(res.status).toBe('not-running');
    });
    (0, vitest_1.it)('stopDaemon cleans stale pidfile when PID is dead', async () => {
        // 2^22 — exceeds typical pid_max
        fs_1.default.writeFileSync(pidFile, '4194303');
        fs_1.default.writeFileSync(socketPath, 'dangling');
        const res = await (0, daemon_1.stopDaemon)({ pidFile, socketPath });
        (0, vitest_1.expect)(res.status).toBe('stale-cleaned');
        (0, vitest_1.expect)(fs_1.default.existsSync(pidFile)).toBe(false);
        (0, vitest_1.expect)(fs_1.default.existsSync(socketPath)).toBe(false);
    });
});
(0, vitest_1.describe)('tailLogs', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-logs-test-'));
    });
    (0, vitest_1.afterEach)(() => {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    });
    (0, vitest_1.it)('lists available logs when no name is given', async () => {
        fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'foo.log'), 'x');
        fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'bar.log'), 'y');
        const logs = [];
        const origLog = console.log;
        console.log = (msg) => logs.push(String(msg ?? ''));
        try {
            await (0, daemon_1.tailLogs)({ logsDir: tmpDir });
        }
        finally {
            console.log = origLog;
        }
        const output = logs.join('\n');
        (0, vitest_1.expect)(output).toContain('foo');
        (0, vitest_1.expect)(output).toContain('bar');
    });
    (0, vitest_1.it)('prints the tail of a named log', async () => {
        const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
        fs_1.default.writeFileSync(path_1.default.join(tmpDir, 'srv.log'), content);
        let out = '';
        const origWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = (s) => {
            out += s;
            return true;
        };
        try {
            await (0, daemon_1.tailLogs)({ name: 'srv', lines: 3, logsDir: tmpDir });
        }
        finally {
            process.stdout.write = origWrite;
        }
        (0, vitest_1.expect)(out).toContain('line 20');
        (0, vitest_1.expect)(out).toContain('line 18');
        (0, vitest_1.expect)(out).not.toContain('line 1\n');
    });
    (0, vitest_1.it)('prints a clear message when the named log does not exist', async () => {
        const errs = [];
        const origErr = console.error;
        console.error = (msg) => errs.push(String(msg ?? ''));
        try {
            await (0, daemon_1.tailLogs)({ name: 'missing', logsDir: tmpDir });
        }
        finally {
            console.error = origErr;
        }
        (0, vitest_1.expect)(errs.join('\n')).toMatch(/No log for server/);
    });
});
//# sourceMappingURL=daemon.test.js.map