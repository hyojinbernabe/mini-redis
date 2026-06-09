import net from 'node:net';
import { AppendOnlyFile, type FsyncPolicy, loadAof } from './aof.ts';
import { type CommandContext, execute } from './commands/index.ts';
import { OK, ProtocolError, RespParser, errorReply } from './resp.ts';
import { Store } from './store.ts';

export interface ServerOptions {
  port: number;
  host: string;
  appendOnly: boolean;
  appendFilename: string;
  appendFsync: FsyncPolicy;
  // for tests, lets them control time
  now?: () => number;
}

export interface RunningServer {
  port: number;
  store: Store;
  loadedCommands: number;
  close(): Promise<void>;
}

// redis runs its background jobs 10 times a second (hz 10), so do we
const ACTIVE_EXPIRE_INTERVAL_MS = 100;

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const store = new Store(options.now);
  const ctx: CommandContext = {
    store,
    aof: null,
  };

  let loadedCommands = 0;
  if (options.appendOnly) {
    loadedCommands = loadAof(options.appendFilename, ctx);
    ctx.aof = new AppendOnlyFile(options.appendFilename, options.appendFsync);
  }

  const sweepTimer = setInterval(() => store.activeExpireCycle(), ACTIVE_EXPIRE_INTERVAL_MS);
  sweepTimer.unref();

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleConnection(socket, ctx);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });

  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    store,
    loadedCommands,
    async close() {
      clearInterval(sweepTimer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.aof?.close();
    },
  };
}

function handleConnection(socket: net.Socket, ctx: CommandContext): void {
  const parser = new RespParser();

  socket.on('data', (chunk: Buffer) => {
    let commands: Buffer[][];
    try {
      commands = parser.feed(chunk);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      // same as redis: report the problem and hang up, the stream can't be trusted anymore
      socket.end(errorReply(`ERR Protocol error: ${error.message}`));
      return;
    }

    // one data event can hold many pipelined commands. answer them all with one write
    const replies: Buffer[] = [];
    let quit = false;
    for (const args of commands) {
      if (args[0].toString().toLowerCase() === 'quit') {
        replies.push(OK);
        quit = true;
        break;
      }
      replies.push(execute(args, ctx));
    }

    ctx.aof?.flush();
    if (replies.length > 0) socket.write(replies.length === 1 ? replies[0] : Buffer.concat(replies));
    if (quit) socket.end();
  });

  // a client disconnecting mid-write shouldn't crash the server
  socket.on('error', () => socket.destroy());
}
