import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { API_PREFIX, type RealtimeAuthMessage, type RealtimeEvent, type RealtimeServerMessage } from '@reclaimed/shared';
import { verifyRequestSignature } from '@reclaimed/shared/node';
import type { Database } from '@reclaimed/database';
import type { AuthVerifier } from '../lib/auth.js';
import type { Logger } from '../logger.js';

export interface RealtimePublisher {
  toUser(userId: string, event: RealtimeEvent): void;
  toTerminal(terminalId: string, event: RealtimeEvent): void;
  /** Hardware status goes to terminals and (in development) signed-in users. */
  hardware(event: RealtimeEvent): void;
}

export class NoopPublisher implements RealtimePublisher {
  readonly events: { target: string; event: RealtimeEvent }[] = [];
  toUser(userId: string, event: RealtimeEvent) {
    this.events.push({ target: `user:${userId}`, event });
  }
  toTerminal(terminalId: string, event: RealtimeEvent) {
    this.events.push({ target: `terminal:${terminalId}`, event });
  }
  hardware(event: RealtimeEvent) {
    this.events.push({ target: 'hardware', event });
  }
}

interface Client {
  socket: WebSocket;
  kind: 'user' | 'terminal';
  id: string;
}

/**
 * Authenticated WebSocket fan-out at /api/v1/realtime. The first message must be
 * an auth message (Supabase access token, or an HMAC-signed terminal handshake);
 * unauthenticated sockets are closed after 5 seconds.
 */
export class RealtimeHub implements RealtimePublisher {
  private readonly clients = new Set<Client>();
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly deps: {
      db: Database;
      authVerifier: AuthVerifier;
      terminalSecrets: Map<string, string>;
      logger: Logger;
      hardwareToUsers: boolean;
    },
  ) {}

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: `${API_PREFIX}/realtime`, maxPayload: 16 * 1024 });
    this.wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => this.onConnection(socket));
    const ping = setInterval(() => {
      for (const c of this.clients) if (c.socket.readyState === c.socket.OPEN) c.socket.ping();
    }, 25_000);
    this.wss.on('close', () => clearInterval(ping));
  }

  private onConnection(socket: WebSocket): void {
    const timer = setTimeout(() => socket.close(4401, 'auth timeout'), 5_000);
    socket.once('message', async (raw) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(String(raw)) as RealtimeAuthMessage;
        let client: Client;
        if (msg.type === 'auth') {
          const user = await this.deps.authVerifier.verify(msg.accessToken);
          client = { socket, kind: 'user', id: user.userId };
        } else if (msg.type === 'auth_terminal') {
          const t = await this.deps.db.query<{ id: string; terminal_code: string }>(
            'select id, terminal_code from test_terminals where terminal_code = $1 and is_active',
            [msg.terminalId],
          );
          const secret = t.rows[0] ? this.deps.terminalSecrets.get(t.rows[0].terminal_code) : undefined;
          const valid =
            secret &&
            verifyRequestSignature(secret, { timestamp: msg.timestamp, method: 'WS', path: `${API_PREFIX}/realtime`, body: msg.terminalId }, msg.signature);
          if (!valid) throw new Error('terminal auth failed');
          client = { socket, kind: 'terminal', id: t.rows[0]!.id };
        } else {
          throw new Error('unknown auth message');
        }
        this.clients.add(client);
        socket.on('close', () => this.clients.delete(client));
        this.send(socket, { type: 'ready', subject: client.kind });
      } catch (err) {
        this.deps.logger.warn({ err: (err as Error).message }, 'realtime auth rejected');
        this.send(socket, { type: 'error', code: 'AUTH_UNAUTHORIZED', message: 'Realtime authentication failed.' });
        socket.close(4401, 'unauthorized');
      }
    });
  }

  private send(socket: WebSocket, msg: RealtimeServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  private emit(filter: (c: Client) => boolean, event: RealtimeEvent): void {
    for (const c of this.clients) if (filter(c)) this.send(c.socket, { type: 'event', event });
  }

  toUser(userId: string, event: RealtimeEvent): void {
    this.emit((c) => c.kind === 'user' && c.id === userId, event);
  }

  toTerminal(terminalId: string, event: RealtimeEvent): void {
    this.emit((c) => c.kind === 'terminal' && c.id === terminalId, event);
  }

  hardware(event: RealtimeEvent): void {
    this.emit((c) => c.kind === 'terminal' || (this.deps.hardwareToUsers && c.kind === 'user'), event);
  }

  close(): void {
    this.wss?.close();
  }
}
