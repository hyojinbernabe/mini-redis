import { describe, expect, it } from 'vitest';
import {
  ProtocolError,
  RespParser,
  arrayReply,
  bulkString,
  encodeCommand,
  integerReply,
  simpleString,
} from '../src/resp.ts';

const toStrings = (commands: Buffer[][]) => commands.map((args) => args.map(String));

describe('RespParser', () => {
  it('parses a single command', () => {
    const parser = new RespParser();
    const commands = parser.feed(Buffer.from('*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n'));
    expect(toStrings(commands)).toEqual([['GET', 'foo']]);
    expect(parser.pendingBytes).toBe(0);
  });

  it('parses pipelined commands from one chunk', () => {
    const parser = new RespParser();
    const input =
      '*3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n' +
      '*2\r\n$4\r\nINCR\r\n$1\r\na\r\n' +
      '*1\r\n$4\r\nPING\r\n';
    expect(toStrings(parser.feed(Buffer.from(input)))).toEqual([
      ['SET', 'a', '1'],
      ['INCR', 'a'],
      ['PING'],
    ]);
  });

  it('handles a command split at every possible byte', () => {
    const input = Buffer.from('*3\r\n$3\r\nSET\r\n$5\r\nhello\r\n$5\r\nworld\r\n*1\r\n$4\r\nPING\r\n');

    for (let split = 1; split < input.length; split++) {
      const parser = new RespParser();
      const first = parser.feed(input.subarray(0, split));
      const second = parser.feed(input.subarray(split));
      expect(toStrings([...first, ...second])).toEqual([['SET', 'hello', 'world'], ['PING']]);
      expect(parser.pendingBytes).toBe(0);
    }
  });

  it('handles input arriving one byte at a time', () => {
    const parser = new RespParser();
    const input = Buffer.from('*2\r\n$4\r\nECHO\r\n$11\r\nhello world\r\n');
    const commands: Buffer[][] = [];
    for (const byte of input) commands.push(...parser.feed(Buffer.from([byte])));
    expect(toStrings(commands)).toEqual([['ECHO', 'hello world']]);
  });

  it('keeps an incomplete command until the rest arrives', () => {
    const parser = new RespParser();
    expect(parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n*2\r\n$3\r\nGET'))).toHaveLength(1);
    expect(parser.pendingBytes).toBeGreaterThan(0);
    expect(toStrings(parser.feed(Buffer.from('\r\n$1\r\nx\r\n')))).toEqual([['GET', 'x']]);
  });

  it('is binary safe, CRLF inside a bulk string is just data', () => {
    const parser = new RespParser();
    const value = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0x2a]);
    const input = Buffer.concat([
      Buffer.from('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$5\r\n'),
      value,
      Buffer.from('\r\n'),
    ]);
    const [command] = parser.feed(input);
    expect(command[2].equals(value)).toBe(true);
  });

  it('parses inline commands', () => {
    const parser = new RespParser();
    expect(toStrings(parser.feed(Buffer.from('SET  foo bar\r\nPING\n')))).toEqual([
      ['SET', 'foo', 'bar'],
      ['PING'],
    ]);
  });

  it('skips empty arrays and empty inline lines', () => {
    const parser = new RespParser();
    expect(toStrings(parser.feed(Buffer.from('*0\r\n\r\nPING\r\n')))).toEqual([['PING']]);
  });

  it('rejects malformed input', () => {
    expect(() => new RespParser().feed(Buffer.from('*1\r\n+PING\r\n'))).toThrow(ProtocolError);
    expect(() => new RespParser().feed(Buffer.from('*x\r\n'))).toThrow(ProtocolError);
    expect(() => new RespParser().feed(Buffer.from('*1\r\n$-5\r\n'))).toThrow(ProtocolError);
    expect(() => new RespParser().feed(Buffer.from('*1\r\n$2\r\nabcd\r\n'))).toThrow(ProtocolError);
  });
});

describe('encoding', () => {
  it('encodes each reply type', () => {
    expect(simpleString('OK').toString()).toBe('+OK\r\n');
    expect(integerReply(42).toString()).toBe(':42\r\n');
    expect(integerReply(-(2n ** 63n)).toString()).toBe(':-9223372036854775808\r\n');
    expect(bulkString('hi').toString()).toBe('$2\r\nhi\r\n');
    expect(bulkString(null).toString()).toBe('$-1\r\n');
    expect(arrayReply([bulkString('a'), integerReply(1)]).toString()).toBe('*2\r\n$1\r\na\r\n:1\r\n');
  });

  it('encodes a command so the parser can read it back', () => {
    const encoded = encodeCommand(['SET', 'key', Buffer.from('välue')]);
    expect(toStrings(new RespParser().feed(encoded))).toEqual([['SET', 'key', 'välue']]);
  });
});
