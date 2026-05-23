// RESP (REdis Serialization Protocol) parsing and encoding.
// clients send commands as arrays of bulk strings:
//   *2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n
// redis-cli also accepts "inline" commands typed by hand, like `PING\r\n`.

const STAR = 0x2a; // '*'
const DOLLAR = 0x24; // '$'

const MAX_ARGS = 1024 * 1024;
const MAX_BULK_LENGTH = 512 * 1024 * 1024;
const MAX_INLINE_LENGTH = 64 * 1024;

export class ProtocolError extends Error {}

type ParseResult = { args: Buffer[]; next: number } | null;

export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  // returns every complete command received so far and keeps any partial one
  feed(chunk: Buffer): Buffer[][] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const commands: Buffer[][] = [];

    while (this.buffer.length > 0) {
      const result =
        this.buffer[0] === STAR ? parseArray(this.buffer, 0) : parseInline(this.buffer, 0);
      if (!result) break;
      if (result.args.length > 0) commands.push(result.args);
      this.buffer = this.buffer.subarray(result.next);
    }

    return commands;
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}

function readLine(buffer: Buffer, start: number): { line: string; next: number } | null {
  const text = buffer.toString('latin1', start);
  const index = text.indexOf('\r\n');
  if (index === -1) {
    if (text.length > MAX_INLINE_LENGTH) throw new ProtocolError('too big header');
    return null;
  }
  return { line: text.slice(0, index), next: start + index + 2 };
}

function parseLength(line: string): number {
  if (!/^-?\d+$/.test(line)) throw new ProtocolError('invalid length');
  return parseInt(line, 10);
}

function parseArray(buffer: Buffer, start: number): ParseResult {
  const header = readLine(buffer, start + 1);
  if (!header) return null;

  const count = parseLength(header.line);
  if (count > MAX_ARGS) throw new ProtocolError('invalid multibulk length');
  if (count <= 0) return { args: [], next: header.next };

  const args: Buffer[] = [];
  let offset = header.next;

  for (let i = 0; i < count; i++) {
    if (offset >= buffer.length) return null;
    if (buffer[offset] !== DOLLAR) {
      throw new ProtocolError(`expected '$', got '${String.fromCharCode(buffer[offset])}'`);
    }

    const lengthLine = readLine(buffer, offset + 1);
    if (!lengthLine) return null;

    const length = parseLength(lengthLine.line);
    if (length < 0 || length > MAX_BULK_LENGTH) throw new ProtocolError('invalid bulk length');

    const end = lengthLine.next + length;
    if (end + 2 > buffer.length) return null;
    if (buffer[end] !== 0x0d || buffer[end + 1] !== 0x0a) {
      throw new ProtocolError('bulk string not terminated by CRLF');
    }

    args.push(buffer.subarray(lengthLine.next, end));
    offset = end + 2;
  }

  return { args, next: offset };
}

function parseInline(buffer: Buffer, start: number): ParseResult {
  const newline = buffer.indexOf(0x0a, start);
  if (newline === -1) {
    if (buffer.length - start > MAX_INLINE_LENGTH) throw new ProtocolError('too big inline request');
    return null;
  }

  const line = buffer.toString('utf8', start, newline).replace(/\r$/, '');
  const args = line
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => Buffer.from(part));

  return { args, next: newline + 1 };
}

// encoding replies

const CRLF = Buffer.from('\r\n');

export const OK = Buffer.from('+OK\r\n');
export const NULL_BULK = Buffer.from('$-1\r\n');
export const NULL_ARRAY = Buffer.from('*-1\r\n');

export function simpleString(value: string): Buffer {
  return Buffer.from(`+${value}\r\n`);
}

export function errorReply(message: string): Buffer {
  return Buffer.from(`-${message}\r\n`);
}

export function integerReply(value: number | bigint): Buffer {
  return Buffer.from(`:${value}\r\n`);
}

export function bulkString(value: Buffer | string | null): Buffer {
  if (value === null) return NULL_BULK;
  const data = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([Buffer.from(`$${data.length}\r\n`), data, CRLF]);
}

export function arrayReply(items: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(`*${items.length}\r\n`), ...items]);
}

// commands are written to the AOF in the same format clients send them
export function encodeCommand(args: Array<Buffer | string>): Buffer {
  return arrayReply(args.map(bulkString));
}
