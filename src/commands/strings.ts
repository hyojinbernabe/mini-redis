import { NULL_BULK, OK, bulkString } from '../resp.ts';
import { type Command, CommandError, SYNTAX_ERROR, getString, parseInteger } from './types.ts';

interface SetOptions {
  expireAt: number | null;
  keepTtl: boolean;
  onlyIfMissing: boolean;
  onlyIfExists: boolean;
}

// SET key value [NX | XX] [EX seconds | PX milliseconds | KEEPTTL]
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
    } else if ((option === 'EX' || option === 'PX') && !hasExpiry) {
      if (i + 1 >= args.length) throw new CommandError(SYNTAX_ERROR);
      const amount = parseInteger(args[++i]);
      if (amount <= 0) throw new CommandError("ERR invalid expire time in 'set' command");

      if (option === 'EX') options.expireAt = now + amount * 1000;
      else options.expireAt = now + amount;
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
};

const get: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    return bulkString(getString(ctx, args[1].toString()));
  },
};

export const stringCommands: Record<string, Command> = { set, get };
