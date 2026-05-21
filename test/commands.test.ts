import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../src/commands/index.ts';
import { createContext, run } from './helpers.ts';

let ctx: CommandContext;

beforeEach(() => {
  ctx = createContext();
});

describe('errors', () => {
  it('replies to unknown commands like redis does', () => {
    expect(run(ctx, 'FOO', 'bar', 'baz')).toBe(
      "-ERR unknown command 'FOO', with args beginning with: 'bar' 'baz' \r\n",
    );
  });

  it('checks the number of arguments', () => {
    expect(run(ctx, 'GET')).toBe("-ERR wrong number of arguments for 'get' command\r\n");
    expect(run(ctx, 'GET', 'a', 'b')).toBe("-ERR wrong number of arguments for 'get' command\r\n");
  });

  it('command names are case insensitive', () => {
    expect(run(ctx, 'ping')).toBe('+PONG\r\n');
    expect(run(ctx, 'PiNg', 'hey')).toBe('$3\r\nhey\r\n');
  });
});

describe('strings', () => {
  it('SET and GET', () => {
    expect(run(ctx, 'GET', 'name')).toBe('$-1\r\n');
    expect(run(ctx, 'SET', 'name', 'hyojin')).toBe('+OK\r\n');
    expect(run(ctx, 'GET', 'name')).toBe('$6\r\nhyojin\r\n');
  });

  it('SET NX only sets missing keys, XX only existing ones', () => {
    expect(run(ctx, 'SET', 'k', '1', 'XX')).toBe('$-1\r\n');
    expect(run(ctx, 'SET', 'k', '1', 'NX')).toBe('+OK\r\n');
    expect(run(ctx, 'SET', 'k', '2', 'NX')).toBe('$-1\r\n');
    expect(run(ctx, 'SET', 'k', '3', 'XX')).toBe('+OK\r\n');
    expect(run(ctx, 'GET', 'k')).toBe('$1\r\n3\r\n');
  });

  it('SET rejects bad options', () => {
    expect(run(ctx, 'SET', 'k', 'v', 'NX', 'XX')).toBe('-ERR syntax error\r\n');
    expect(run(ctx, 'SET', 'k', 'v', 'EX', '10', 'PX', '100')).toBe('-ERR syntax error\r\n');
    expect(run(ctx, 'SET', 'k', 'v', 'EX')).toBe('-ERR syntax error\r\n');
    expect(run(ctx, 'SET', 'k', 'v', 'EX', 'soon')).toBe(
      '-ERR value is not an integer or out of range\r\n',
    );
    expect(run(ctx, 'SET', 'k', 'v', 'EX', '0')).toBe(
      "-ERR invalid expire time in 'set' command\r\n",
    );
    expect(run(ctx, 'SET', 'k', 'v', 'FOREVER')).toBe('-ERR syntax error\r\n');
  });
});
