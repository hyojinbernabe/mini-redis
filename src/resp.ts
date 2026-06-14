// RESP (REdis Serialization Protocol) parsing and encoding.
// clients send commands as arrays of bulk strings:
//   *2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n
// redis-cli also accepts "inline" commands typed by hand, like `PING\r\n`.

const STAR = 0x2a; // '*'
const DOLLAR = 0x24; // '$'
const MINUS = 0x2d; // '-'
const CR = 0x0d;
const LF = 0x0a;

const MAX_ARGS = 1024 * 1024;
const MAX_BULK_LENGTH = 512 * 1024 * 1024;
const MAX_INLINE_LENGTH = 64 * 1024;

export class ProtocolError extends Error {}

type ParseResult = { args: Buffer[]; next: number } | null;

export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  // returns every complete command received so far and keeps any partial one
  feed(chunk: Buffer): Buffer[][] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const commands: Buffer[][] = [];
    let offset = 0;

    // walk the buffer with an offset and only cut it once at the end,
    // instead of slicing after every command
    while (offset < this.buffer.length) {
      const result =
        this.buffer[offset] === STAR
          ? parseArray(this.buffer, offset)
          : parseInline(this.buffer, offset);
      if (!result) break;
      if (result.args.length > 0) commands.push(result.args);
      offset = result.next;
    }

    this.buffer = this.buffer.subarray(offset);
    return commands;
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }
}

// reads the number on a header line like "*3\r\n" or "$11\r\n" straight from the bytes.
// returns null if the line isn't complete yet
function readLength(buffer: Buffer, start: number): { value: number; next: number } | null {
  const lineEnd = buffer.indexOf(CR, start);
  if (lineEnd === -1 || lineEnd + 1 >= buffer.length) {
    if (buffer.length - start > MAX_INLINE_LENGTH) throw new ProtocolError('too big header');
    return null;
  }
  if (buffer[lineEnd + 1] !== LF) throw new ProtocolError('expected CRLF after length');

  let index = start;
  const negative = buffer[index] === MINUS;
  if (negative) index++;
  if (index === lineEnd) throw new ProtocolError('invalid length');

  let value = 0;
  for (; index < lineEnd; index++) {
    const digit = buffer[index] - 0x30;
    if (digit < 0 || digit > 9) throw new ProtocolError('invalid length');
    value = value * 10 + digit;
  }

  return { value: negative ? -value : value, next: lineEnd + 2 };
}

function parseArray(buffer: Buffer, start: number): ParseResult {
  const header = readLength(buffer, start + 1);
  if (!header) return null;

  const count = header.value;
  if (count > MAX_ARGS) throw new ProtocolError('invalid multibulk length');
  if (count <= 0) return { args: [], next: header.next };

  const args: Buffer[] = [];
  let offset = header.next;

  for (let i = 0; i < count; i++) {
    if (offset >= buffer.length) return null;
    if (buffer[offset] !== DOLLAR) {
      throw new ProtocolError(`expected '$', got '${String.fromCharCode(buffer[offset])}'`);
    }

    const length = readLength(buffer, offset + 1);
    if (!length) return null;
    if (length.value < 0 || length.value > MAX_BULK_LENGTH) {
      throw new ProtocolError('invalid bulk length');
    }

    const end = length.next + length.value;
    if (end + 2 > buffer.length) return null;
    if (buffer[end] !== CR || buffer[end + 1] !== LF) {
      throw new ProtocolError('bulk string not terminated by CRLF');
    }

    // copy so a stored value doesn't keep the whole socket chunk alive
    args.push(Buffer.from(buffer.subarray(length.next, end)));
    offset = end + 2;
  }

  return { args, next: offset };
}

function parseInline(buffer: Buffer, start: number): ParseResult {
  const newline = buffer.indexOf(LF, start);
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
