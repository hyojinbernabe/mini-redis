import { bulkString, simpleString } from '../resp.ts';
import { type Command, CommandError } from './types.ts';

const ping: Command = {
  arity: -1,
  write: false,
  run(args) {
    if (args.length > 2) throw new CommandError("ERR wrong number of arguments for 'ping' command");
    return args.length === 2 ? bulkString(args[1]) : simpleString('PONG');
  },
};

const echo: Command = {
  arity: 2,
  write: false,
  run: (args) => bulkString(args[1]),
};

// unlike real redis this doesn't fork, it rewrites the file right away.
// fine for a small dataset, it blocks the server while it runs
const bgrewriteaof: Command = {
  arity: 1,
  write: false,
  run(_args, ctx) {
    if (!ctx.aof) throw new CommandError('ERR append only file is turned off');
    ctx.aof.rewrite(ctx.store);
    return simpleString('Append only file rewritten');
  },
};

export const serverCommands: Record<string, Command> = {
  ping,
  echo,
  bgrewriteaof,
};
