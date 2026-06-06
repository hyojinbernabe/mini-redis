import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppendOnlyFile, loadAof } from '../src/aof.ts';
import type { CommandContext } from '../src/commands/index.ts';
import { FakeClock, createContext, run } from './helpers.ts';

let dir: string;
let aofPath: string;
let clock: FakeClock;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-redis-'));
  aofPath = path.join(dir, 'appendonly.aof');
  clock = new FakeClock();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// a context that logs to the AOF, like the server does
function withAof(): CommandContext {
  const ctx = createContext(clock);
  ctx.aof = new AppendOnlyFile(aofPath, 'always');
  return ctx;
}

function runAndFlush(ctx: CommandContext, ...args: string[]): string {
  const reply = run(ctx, ...args);
  ctx.aof!.flush();
  return reply;
}

function restart(): CommandContext {
  const ctx = createContext(clock);
  loadAof(aofPath, ctx);
  return ctx;
}

describe('append only file', () => {
  it('logs write commands and replays them on startup', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'SET', 'name', 'hyojin');
    runAndFlush(ctx, 'INCR', 'visits');
    runAndFlush(ctx, 'INCR', 'visits');
    runAndFlush(ctx, 'RPUSH', 'list', 'a', 'b');
    runAndFlush(ctx, 'HSET', 'user', 'city', 'baguio');
    runAndFlush(ctx, 'SET', 'gone', 'x');
    runAndFlush(ctx, 'DEL', 'gone');
    ctx.aof!.close();

    const restored = restart();
    expect(run(restored, 'GET', 'name')).toBe('$6\r\nhyojin\r\n');
    expect(run(restored, 'GET', 'visits')).toBe('$1\r\n2\r\n');
    expect(run(restored, 'LRANGE', 'list', '0', '-1')).toBe('*2\r\n$1\r\na\r\n$1\r\nb\r\n');
    expect(run(restored, 'HGET', 'user', 'city')).toBe('$6\r\nbaguio\r\n');
    expect(run(restored, 'EXISTS', 'gone')).toBe(':0\r\n');
  });

  it('does not log read commands', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'GET', 'a');
    runAndFlush(ctx, 'PING');
    ctx.aof!.close();
    expect(fs.readFileSync(aofPath, 'utf8')).toBe('');
  });

  it('stores relative TTLs as absolute times', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'SET', 'session', 'abc', 'EX', '60');
    runAndFlush(ctx, 'SET', 'other', 'x');
    runAndFlush(ctx, 'EXPIRE', 'other', '30');
    ctx.aof!.close();

    const content = fs.readFileSync(aofPath, 'utf8');
    expect(content).toContain(`PXAT\r\n$13\r\n${clock.time + 60_000}`);
    expect(content).toContain(`PEXPIREAT\r\n$5\r\nother\r\n$13\r\n${clock.time + 30_000}`);

    // 20 seconds pass while the server is down, the TTL should keep counting
    clock.advance(20_000);
    const restored = restart();
    expect(run(restored, 'TTL', 'session')).toBe(':40\r\n');
    expect(run(restored, 'TTL', 'other')).toBe(':10\r\n');
  });

  it('keys that expired while the server was down stay gone', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'SET', 'short', 'v', 'PX', '500');
    runAndFlush(ctx, 'SET', 'long', 'v');
    ctx.aof!.close();

    clock.advance(1000);
    const restored = restart();
    expect(run(restored, 'EXISTS', 'short')).toBe(':0\r\n');
    expect(run(restored, 'EXISTS', 'long')).toBe(':1\r\n');
  });

  it('replays PERSIST so the key survives', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'SET', 'k', 'v', 'EX', '1');
    runAndFlush(ctx, 'PERSIST', 'k');
    ctx.aof!.close();

    clock.advance(5000);
    expect(run(restart(), 'GET', 'k')).toBe('$1\r\nv\r\n');
  });

  it('loads what it can from a file cut off mid command and truncates the rest', () => {
    const ctx = withAof();
    runAndFlush(ctx, 'SET', 'a', '1');
    runAndFlush(ctx, 'SET', 'b', '2');
    ctx.aof!.close();

    const fullSize = fs.statSync(aofPath).size;
    fs.appendFileSync(aofPath, '*3\r\n$3\r\nSET\r\n$1\r\nc');

    const restored = createContext(clock);
    expect(loadAof(aofPath, restored)).toBe(2);
    expect(run(restored, 'GET', 'b')).toBe('$1\r\n2\r\n');
    expect(run(restored, 'EXISTS', 'c')).toBe(':0\r\n');
    expect(fs.statSync(aofPath).size).toBe(fullSize);
  });
});
