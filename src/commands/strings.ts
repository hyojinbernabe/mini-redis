import { NULL_BULK, OK, arrayReply, bulkString, integerReply } from '../resp.ts';
import {
  type Command,
  type CommandContext,
  CommandError,
  NOT_INTEGER,
  SYNTAX_ERROR,
  fitsInt64,
  getString,
  parseBigInt,
  parseInteger,
} from './types.ts';

interface SetOptions {
  expireAt: number | null;
  keepTtl: boolean;
  onlyIfMissing: boolean;
  onlyIfExists: boolean;
}

// SET key value [NX | XX] [EX seconds | PX milliseconds | PXAT unix-ms | KEEPTTL]
function parseSetOptions(args: Buffer[], now: number): SetOptions {
  const options: SetOptions = {
    expireAt: null,
    keepTtl: false,
    onlyIfMissing: false,
    onlyIfExists: false,
  };
  let hasExpiry = false;

  for (let i = 3; i < args.length; i++) {
    const option = args[i].toString().toUpperCase();

    if (option === 'NX' && !options.onlyIfExists) {
      options.onlyIfMissing = true;
    } else if (option === 'XX' && !options.onlyIfMissing) {
      options.onlyIfExists = true;
    } else if (option === 'KEEPTTL' && !hasExpiry) {
      options.keepTtl = true;
      hasExpiry = true;
    } else if ((option === 'EX' || option === 'PX' || option === 'PXAT') && !hasExpiry) {
      if (i + 1 >= args.length) throw new CommandError(SYNTAX_ERROR);
      const amount = parseInteger(args[++i]);
      if (amount <= 0) throw new CommandError("ERR invalid expire time in 'set' command");

      if (option === 'EX') options.expireAt = now + amount * 1000;
      else if (option === 'PX') options.expireAt = now + amount;
      else options.expireAt = amount;
      hasExpiry = true;
    } else {
      throw new CommandError(SYNTAX_ERROR);
    }
  }

  return options;
}

const set: Command = {
  arity: -3,
  write: true,
  run(args, ctx) {
    const key = args[1].toString();
    const options = parseSetOptions(args, ctx.store.now());
    const exists = ctx.store.has(key);

    if (options.onlyIfMissing && exists) return NULL_BULK;
    if (options.onlyIfExists && !exists) return NULL_BULK;

    if (options.keepTtl) ctx.store.put(key, { type: 'string', data: args[2] });
    else ctx.store.set(key, { type: 'string', data: args[2] }, options.expireAt);
    return OK;
  },
  // EX/PX are relative to "now", which is a different time when the AOF gets replayed.
  // so we log the absolute expiry instead
  toAof(args, ctx) {
    const key = args[1].toString();
    const command: Array<Buffer | string> = ['SET', args[1], args[2]];
    for (const arg of args.slice(3)) {
      const option = arg.toString().toUpperCase();
      if (option === 'NX' || option === 'XX') command.push(option);
    }

    const expireAt = ctx.store.expireAtOf(key);
    if (expireAt !== undefined) command.push('PXAT', String(expireAt));
    return [command];
  },
};

const get: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    return bulkString(getString(ctx, args[1].toString()));
  },
};

const strlen: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    return integerReply(getString(ctx, args[1].toString())?.length ?? 0);
  },
};

const append: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    const key = args[1].toString();
    const current = getString(ctx, key);
    const data = current ? Buffer.concat([current, args[2]]) : args[2];
    ctx.store.put(key, { type: 'string', data });
    return integerReply(data.length);
  },
};

function incrementBy(ctx: CommandContext, key: string, increment: bigint): Buffer {
  const current = getString(ctx, key);
  const value = current === null ? 0n : parseBigInt(current);
  const result = value + increment;
  if (!fitsInt64(result)) throw new CommandError('ERR increment or decrement would overflow');

  ctx.store.put(key, { type: 'string', data: Buffer.from(result.toString()) });
  return integerReply(result);
}

const incr: Command = {
  arity: 2,
  write: true,
  run: (args, ctx) => incrementBy(ctx, args[1].toString(), 1n),
};

const decr: Command = {
  arity: 2,
  write: true,
  run: (args, ctx) => incrementBy(ctx, args[1].toString(), -1n),
};

const incrby: Command = {
  arity: 3,
  write: true,
  run: (args, ctx) => incrementBy(ctx, args[1].toString(), parseBigInt(args[2])),
};

const decrby: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    const amount = parseBigInt(args[2]);
    // -(-2^63) doesn't fit in 64 bits
    if (!fitsInt64(-amount)) throw new CommandError(NOT_INTEGER);
    return incrementBy(ctx, args[1].toString(), -amount);
  },
};

const mget: Command = {
  arity: -2,
  write: false,
  run(args, ctx) {
    const values = args.slice(1).map((arg) => {
      const value = ctx.store.get(arg.toString());
      // MGET returns nil for keys of other types instead of an error
      return bulkString(value?.type === 'string' ? value.data : null);
    });
    return arrayReply(values);
  },
};

const mset: Command = {
  arity: -3,
  write: true,
  run(args, ctx) {
    if (args.length % 2 === 0) {
      throw new CommandError("ERR wrong number of arguments for 'mset' command");
    }
    for (let i = 1; i < args.length; i += 2) {
      ctx.store.set(args[i].toString(), { type: 'string', data: args[i + 1] });
    }
    return OK;
  },
};

export const stringCommands: Record<string, Command> = {
  set,
  get,
  strlen,
  append,
  incr,
  decr,
  incrby,
  decrby,
  mget,
  mset,
};
