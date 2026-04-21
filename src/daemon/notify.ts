import net from 'net';
import { DAEMON_SOCKET } from '../config/paths';

/**
 * Send a one-shot message to the daemon and close the connection.
 * Silent on failure — the daemon may not be running, which is fine.
 * The install/uninstall flow succeeds regardless of daemon availability.
 */
export async function notifyDaemon(
  msg: Record<string, unknown>,
  socketPath = DAEMON_SOCKET,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => {
      try { socket.write(JSON.stringify(msg) + '\n'); } catch { /* ignore */ }
      socket.end();
    });
    socket.once('close', resolve);
    socket.once('error', resolve);
  });
}
