import net from 'node:net';
import { type CommandContext, execute } from './commands/index.ts';
import { ProtocolError, RespParser, errorReply } from './resp.ts';
import { Store } from './store.ts';

export interface ServerOptions {
  port: number;
  host: string;
}

export interface RunningServer {
  port: number;
  store: Store;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const store = new Store();
  const ctx: CommandContext = {
    store,
  };

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
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
    const replies = commands.map((args) => execute(args, ctx));
    if (replies.length > 0) socket.write(replies.length === 1 ? replies[0] : Buffer.concat(replies));
  });

  // a client disconnecting mid-write shouldn't crash the server
  socket.on('error', () => socket.destroy());
}
