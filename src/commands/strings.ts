import { OK, bulkString } from '../resp.ts';
import { type Command, getString } from './types.ts';

const set: Command = {
  arity: 3,
  write: true,
  run(args, ctx) {
    ctx.store.set(args[1].toString(), { type: 'string', data: args[2] });
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
