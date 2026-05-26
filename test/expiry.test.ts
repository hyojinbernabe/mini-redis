import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../src/commands/index.ts';
import { FakeClock, createContext, run } from './helpers.ts';

let clock: FakeClock;
let ctx: CommandContext;

beforeEach(() => {
  clock = new FakeClock();
  ctx = createContext(clock);
});

describe('lazy expiry', () => {
  it('a key still exists at exactly its expiry time and is gone 1ms later', () => {
    run(ctx, 'SET', 'k', 'v', 'PX', '100');
    clock.advance(100);
    expect(run(ctx, 'GET', 'k')).toBe('$1\r\nv\r\n');
    expect(run(ctx, 'PTTL', 'k')).toBe(':0\r\n');

    clock.advance(1);
    expect(run(ctx, 'GET', 'k')).toBe('$-1\r\n');
    expect(run(ctx, 'EXISTS', 'k')).toBe(':0\r\n');
    expect(run(ctx, 'TTL', 'k')).toBe(':-2\r\n');
  });

  it('SET EX works in seconds', () => {
    run(ctx, 'SET', 'k', 'v', 'EX', '10');
    expect(run(ctx, 'TTL', 'k')).toBe(':10\r\n');
    expect(run(ctx, 'PTTL', 'k')).toBe(':10000\r\n');
    clock.advance(10_001);
    expect(run(ctx, 'GET', 'k')).toBe('$-1\r\n');
  });

  it('TTL is -1 for keys without expiry and -2 for missing keys', () => {
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'TTL', 'k')).toBe(':-1\r\n');
    expect(run(ctx, 'PTTL', 'missing')).toBe(':-2\r\n');
  });

  it('expired keys do not count as deleted or existing', () => {
    run(ctx, 'SET', 'k', 'v', 'PX', '5');
    clock.advance(6);
    expect(run(ctx, 'DEL', 'k')).toBe(':0\r\n');
    expect(run(ctx, 'KEYS', '*')).toBe('*0\r\n');
  });
});

describe('changing a TTL', () => {
  it('a plain SET removes the old TTL', () => {
    run(ctx, 'SET', 'k', 'v', 'EX', '10');
    run(ctx, 'SET', 'k', 'v2');
    expect(run(ctx, 'TTL', 'k')).toBe(':-1\r\n');
  });

  it('SET with a new EX overwrites the old TTL', () => {
    run(ctx, 'SET', 'k', 'v', 'EX', '100');
    run(ctx, 'SET', 'k', 'v', 'EX', '5');
    expect(run(ctx, 'TTL', 'k')).toBe(':5\r\n');
  });

  it('SET KEEPTTL keeps it', () => {
    run(ctx, 'SET', 'k', 'v', 'EX', '100');
    run(ctx, 'SET', 'k', 'v2', 'KEEPTTL');
    expect(run(ctx, 'TTL', 'k')).toBe(':100\r\n');
  });

  it('INCR and APPEND keep the TTL', () => {
    run(ctx, 'SET', 'n', '1', 'EX', '100');
    run(ctx, 'INCR', 'n');
    run(ctx, 'APPEND', 'n', '0');
    expect(run(ctx, 'TTL', 'n')).toBe(':100\r\n');
    expect(run(ctx, 'GET', 'n')).toBe('$2\r\n20\r\n');
  });

  it('EXPIRE and PEXPIRE set a TTL on existing keys only', () => {
    expect(run(ctx, 'EXPIRE', 'missing', '10')).toBe(':0\r\n');
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'EXPIRE', 'k', '10')).toBe(':1\r\n');
    expect(run(ctx, 'TTL', 'k')).toBe(':10\r\n');
    expect(run(ctx, 'PEXPIRE', 'k', '1500')).toBe(':1\r\n');
    expect(run(ctx, 'PTTL', 'k')).toBe(':1500\r\n');
  });

  it('EXPIRE with zero or a negative time deletes the key', () => {
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'EXPIRE', 'k', '0')).toBe(':1\r\n');
    expect(run(ctx, 'EXISTS', 'k')).toBe(':0\r\n');
    run(ctx, 'SET', 'k', 'v');
    expect(run(ctx, 'PEXPIRE', 'k', '-100')).toBe(':1\r\n');
    expect(run(ctx, 'EXISTS', 'k')).toBe(':0\r\n');
  });

  it('PERSIST removes the TTL', () => {
    run(ctx, 'SET', 'k', 'v', 'EX', '10');
    expect(run(ctx, 'PERSIST', 'k')).toBe(':1\r\n');
    expect(run(ctx, 'TTL', 'k')).toBe(':-1\r\n');
    expect(run(ctx, 'PERSIST', 'k')).toBe(':0\r\n');
    expect(run(ctx, 'PERSIST', 'missing')).toBe(':0\r\n');
    clock.advance(20_000);
    expect(run(ctx, 'GET', 'k')).toBe('$1\r\nv\r\n');
  });

  it('PERSIST on an already expired key does nothing', () => {
    run(ctx, 'SET', 'k', 'v', 'PX', '10');
    clock.advance(11);
    expect(run(ctx, 'PERSIST', 'k')).toBe(':0\r\n');
    expect(run(ctx, 'GET', 'k')).toBe('$-1\r\n');
  });
});
