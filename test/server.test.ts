import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from '../src/server.ts';

let server: RunningServer;

beforeEach(async () => {
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    appendOnly: false,
    appendFilename: '',
    appendFsync: 'no',
  });
});

afterEach(async () => {
  await server.close();
});

function connect(): Promise<net.Socket> {
  return new Promise((resolve) => {
    const socket = net.connect(server.port, '127.0.0.1', () => resolve(socket));
  });
}

// reads from the socket until the expected number of bytes arrived
function readBytes(socket: net.Socket, length: number): Promise<string> {
  return new Promise((resolve) => {
    let received = '';
    const onData = (chunk: Buffer) => {
      received += chunk.toString();
      if (received.length >= length) {
        socket.off('data', onData);
        resolve(received);
      }
    };
    socket.on('data', onData);
  });
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('tcp server', () => {
  it('answers a command', async () => {
    const socket = await connect();
    socket.write('*1\r\n$4\r\nPING\r\n');
    expect(await readBytes(socket, 7)).toBe('+PONG\r\n');
    socket.destroy();
  });

  it('answers pipelined commands in order', async () => {
    const socket = await connect();
    const expected = '+OK\r\n:2\r\n$1\r\n2\r\n+PONG\r\n';
    const reply = readBytes(socket, expected.length);
    socket.write(
      '*3\r\n$3\r\nSET\r\n$1\r\nn\r\n$1\r\n1\r\n' +
        '*2\r\n$4\r\nINCR\r\n$1\r\nn\r\n' +
        '*2\r\n$3\r\nGET\r\n$1\r\nn\r\n' +
        'PING\r\n',
    );
    expect(await reply).toBe(expected);
    socket.destroy();
  });

  it('waits for the rest of a command split across packets', async () => {
    const socket = await connect();
    socket.setNoDelay(true);
    const reply = readBytes(socket, 5);

    const parts = ['*3\r\n$3\r\nS', 'ET\r\n$3\r\nke', 'y\r\n$5\r\nval', 'ue\r\n'];
    for (const part of parts) {
      socket.write(part);
      await wait(20);
    }
    expect(await reply).toBe('+OK\r\n');
    expect(server.store.get('key')?.data.toString()).toBe('value');
    socket.destroy();
  });

  it('keeps clients separate', async () => {
    const first = await connect();
    const second = await connect();
    const firstReply = readBytes(first, 7);
    const secondReply = readBytes(second, 5);
    // the second client sends half a command, which must not mix with the first one
    second.write('*2\r\n$3\r\nGET');
    await wait(20);
    first.write('*1\r\n$4\r\nPING\r\n');
    expect(await firstReply).toBe('+PONG\r\n');

    second.write('\r\n$1\r\nx\r\n');
    expect(await secondReply).toBe('$-1\r\n');
    first.destroy();
    second.destroy();
  });

  it('replies with an error and closes on a protocol error', async () => {
    const socket = await connect();
    const closed = new Promise((resolve) => socket.on('end', resolve));
    const reply = readBytes(socket, 10);
    socket.write('*1\r\n+PING\r\n');
    expect(await reply).toMatch(/^-ERR Protocol error/);
    await closed;
    socket.destroy();
  });

  it('QUIT says OK and closes the connection', async () => {
    const socket = await connect();
    const closed = new Promise((resolve) => socket.on('end', resolve));
    const reply = readBytes(socket, 5);
    socket.write('*1\r\n$4\r\nQUIT\r\n');
    expect(await reply).toBe('+OK\r\n');
    await closed;
    socket.destroy();
  });
});
