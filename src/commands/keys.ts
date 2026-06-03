import { globToRegExp } from '../glob.ts';
import { OK, arrayReply, bulkString, integerReply, simpleString } from '../resp.ts';
import { type Command, type CommandContext, CommandError, parseInteger } from './types.ts';

const del: Command = {
  arity: -2,
  write: true,
  run(args, ctx) {
    let removed = 0;
    for (const arg of args.slice(1)) {
      const key = arg.toString();
      // has() first so an already expired key doesn't count as deleted
      if (ctx.store.has(key) && ctx.store.delete(key)) removed++;
    }
    return integerReply(removed);
  },
};

const exists: Command = {
  arity: -2,
  write: false,
  run(args, ctx) {
    // repeated keys count every time, like redis
    const count = args.slice(1).filter((arg) => ctx.store.has(arg.toString())).length;
    return integerReply(count);
  },
};

const type: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    return simpleString(ctx.store.get(args[1].toString())?.type ?? 'none');
  },
};

function expireAt(ctx: CommandContext, key: string, when: number): Buffer {
  if (!ctx.store.has(key)) return integerReply(0);
  // a time in the past just deletes the key
  if (when <= ctx.store.now()) ctx.store.delete(key);
  else ctx.store.setExpireAt(key, when);
  return integerReply(1);
}

function parseExpireTime(arg: Buffer, multiplier: number, commandName: string): number {
  const value = parseInteger(arg) * multiplier;
  if (!Number.isSafeInteger(value)) {
    throw new CommandError(`ERR invalid expire time in '${commandName}' command`);
  }
  return value;
}

// relative TTLs go into the AOF as an absolute time, see SET in strings.ts
function expireToAof(args: Buffer[], ctx: CommandContext): Array<Array<Buffer | string>> {
  const when = ctx.store.expireAtOf(args[1].toString());
  if (when === undefined) return [['DEL', args[1]]];
  return [['PEXPIREAT', args[1], String(when)]];
}

const expire: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    const seconds = parseExpireTime(args[2], 1000, 'expire');
    return expireAt(ctx, args[1].toString(), ctx.store.now() + seconds);
  },
  toAof: expireToAof,
};

const pexpire: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    const milliseconds = parseExpireTime(args[2], 1, 'pexpire');
    return expireAt(ctx, args[1].toString(), ctx.store.now() + milliseconds);
  },
  toAof: expireToAof,
};

const pexpireat: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    return expireAt(ctx, args[1].toString(), parseExpireTime(args[2], 1, 'pexpireat'));
  },
};

// -2 means the key doesn't exist, -1 means it has no TTL
function remainingTtl(ctx: CommandContext, key: string): number | null {
  if (!ctx.store.has(key)) return -2;
  const when = ctx.store.expireAtOf(key);
  if (when === undefined) return -1;
  return null;
}

const ttl: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    const key = args[1].toString();
    const special = remainingTtl(ctx, key);
    if (special !== null) return integerReply(special);
    const milliseconds = Math.max(0, ctx.store.expireAtOf(key)! - ctx.store.now());
    // redis rounds to the nearest second
    return integerReply(Math.floor((milliseconds + 500) / 1000));
  },
};

const pttl: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    const key = args[1].toString();
    const special = remainingTtl(ctx, key);
    if (special !== null) return integerReply(special);
    return integerReply(Math.max(0, ctx.store.expireAtOf(key)! - ctx.store.now()));
  },
};

const persist: Command = {
  arity: 2,
  write: true,
  run(args, ctx) {
    return integerReply(ctx.store.persist(args[1].toString()) ? 1 : 0);
  },
};

const keys: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    const pattern = globToRegExp(args[1].toString());
    const matches = ctx.store.keys().filter((key) => pattern.test(key));
    return arrayReply(matches.map((key) => bulkString(key)));
  },
};

const dbsize: Command = {
  arity: 1,
  write: false,
  run(_args, ctx) {
    return integerReply(ctx.store.size);
  },
};

const flushall: Command = {
  // accepts the ASYNC / SYNC flag but always flushes right away
  arity: -1,
  write: true,
  run(_args, ctx) {
    ctx.store.flush();
    return OK;
  },
};

export const keyCommands: Record<string, Command> = {
  del,
  exists,
  type,
  expire,
  pexpire,
  pexpireat,
  ttl,
  pttl,
  persist,
  keys,
  dbsize,
  flushall,
};
