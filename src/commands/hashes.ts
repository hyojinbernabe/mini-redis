import { arrayReply, bulkString, integerReply } from '../resp.ts';
import { type Command, CommandError, getHash } from './types.ts';

const hset: Command = {
  arity: -4,
  write: true,
  run(args, ctx) {
    if (args.length % 2 !== 0) {
      throw new CommandError("ERR wrong number of arguments for 'hset' command");
    }

    const key = args[1].toString();
    let hash = getHash(ctx, key);
    if (!hash) {
      hash = new Map();
      ctx.store.put(key, { type: 'hash', data: hash });
    }

    let added = 0;
    for (let i = 2; i < args.length; i += 2) {
      const field = args[i].toString();
      if (!hash.has(field)) added++;
      hash.set(field, args[i + 1]);
    }
    return integerReply(added);
  },
};

const hget: Command = {
  arity: 3,
  write: false,
  run(args, ctx) {
    const hash = getHash(ctx, args[1].toString());
    return bulkString(hash?.get(args[2].toString()) ?? null);
  },
};

const hdel: Command = {
  arity: -3,
  write: true,
  run(args, ctx) {
    const key = args[1].toString();
    const hash = getHash(ctx, key);
    if (!hash) return integerReply(0);

    let removed = 0;
    for (const field of args.slice(2)) {
      if (hash.delete(field.toString())) removed++;
    }
    if (hash.size === 0) ctx.store.delete(key);
    return integerReply(removed);
  },
};

const hgetall: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    const hash = getHash(ctx, args[1].toString());
    const items: Buffer[] = [];
    for (const [field, value] of hash ?? []) {
      items.push(bulkString(field), bulkString(value));
    }
    return arrayReply(items);
  },
};

export const hashCommands: Record<string, Command> = { hset, hget, hdel, hgetall };
