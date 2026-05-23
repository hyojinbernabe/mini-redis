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
    expect(run(ctx, 'MSET', 'a', '1', 'b')).toBe(
      "-ERR wrong number of arguments for 'mset' command\r\n",
    );
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

  it('INCR, DECR, INCRBY, DECRBY', () => {
    expect(run(ctx, 'INCR', 'counter')).toBe(':1\r\n');
    expect(run(ctx, 'INCRBY', 'counter', '10')).toBe(':11\r\n');
    expect(run(ctx, 'DECR', 'counter')).toBe(':10\r\n');
    expect(run(ctx, 'DECRBY', 'counter', '15')).toBe(':-5\r\n');
    expect(run(ctx, 'GET', 'counter')).toBe('$2\r\n-5\r\n');
  });

  it('INCR refuses values that are not integers', () => {
    run(ctx, 'SET', 'k', 'abc');
    expect(run(ctx, 'INCR', 'k')).toBe('-ERR value is not an integer or out of range\r\n');
    run(ctx, 'SET', 'k', '007');
    expect(run(ctx, 'INCR', 'k')).toBe('-ERR value is not an integer or out of range\r\n');
    expect(run(ctx, 'INCRBY', 'n', '1.5')).toBe('-ERR value is not an integer or out of range\r\n');
  });

  it('INCR stays inside 64 bit signed integers', () => {
    run(ctx, 'SET', 'big', '9223372036854775806');
    expect(run(ctx, 'INCR', 'big')).toBe(':9223372036854775807\r\n');
    expect(run(ctx, 'INCR', 'big')).toBe('-ERR increment or decrement would overflow\r\n');
    expect(run(ctx, 'GET', 'big')).toBe('$19\r\n9223372036854775807\r\n');
  });

  it('APPEND and STRLEN', () => {
    expect(run(ctx, 'APPEND', 'greeting', 'hello')).toBe(':5\r\n');
    expect(run(ctx, 'APPEND', 'greeting', ' world')).toBe(':11\r\n');
    expect(run(ctx, 'GET', 'greeting')).toBe('$11\r\nhello world\r\n');
    expect(run(ctx, 'STRLEN', 'greeting')).toBe(':11\r\n');
  });

  it('MSET and MGET', () => {
    expect(run(ctx, 'MSET', 'a', '1', 'b', '2')).toBe('+OK\r\n');
    expect(run(ctx, 'MGET', 'a', 'missing', 'b')).toBe('*3\r\n$1\r\n1\r\n$-1\r\n$1\r\n2\r\n');
  });
});

describe('keys', () => {
  it('DEL and EXISTS count keys', () => {
    run(ctx, 'MSET', 'a', '1', 'b', '2');
    expect(run(ctx, 'EXISTS', 'a', 'a', 'b', 'c')).toBe(':3\r\n');
    expect(run(ctx, 'DEL', 'a', 'c')).toBe(':1\r\n');
    expect(run(ctx, 'EXISTS', 'a')).toBe(':0\r\n');
  });

  it('KEYS matches glob patterns', () => {
    run(ctx, 'MSET', 'user:1', 'a', 'user:2', 'b', 'session:1', 'c', 'h?llo', 'd');
    const keys = (pattern: string) =>
      run(ctx, 'KEYS', pattern)
        .split('\r\n')
        .filter((line) => line && !/^[*$]/.test(line))
        .sort();

    expect(keys('user:*')).toEqual(['user:1', 'user:2']);
    expect(keys('*:1')).toEqual(['session:1', 'user:1']);
    expect(keys('user:[13]')).toEqual(['user:1']);
    expect(keys('user:[!1]')).toEqual(['user:2']);
    expect(keys('h\\?llo')).toEqual(['h?llo']);
    expect(keys('*')).toHaveLength(4);
  });
});
