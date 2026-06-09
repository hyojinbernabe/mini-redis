import { globToRegExp } from '../glob.ts';
import { OK, arrayReply, bulkString, simpleString } from '../resp.ts';
import { type Command, CommandError, parseInteger } from './types.ts';

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

// only one database, but redis-benchmark and some clients send SELECT 0
const select: Command = {
  arity: 2,
  write: false,
  run(args) {
    if (parseInteger(args[1]) !== 0) throw new CommandError('ERR DB index is out of range');
    return OK;
  },
};

// redis-cli asks for COMMAND DOCS on startup to show hints. an empty list is fine
const command: Command = {
  arity: -1,
  write: false,
  run: () => arrayReply([]),
};

// read only, enough for redis-benchmark and redis-cli to stop complaining
const config: Command = {
  arity: -2,
  write: false,
  run(args, ctx) {
    const subcommand = args[1].toString().toUpperCase();
    if (subcommand !== 'GET' || args.length !== 3) {
      throw new CommandError(`ERR unknown subcommand '${args[1]}'. Only CONFIG GET is supported.`);
    }

    const pattern = globToRegExp(args[2].toString().toLowerCase());
    const items: Buffer[] = [];
    for (const [name, value] of Object.entries(ctx.config)) {
      if (pattern.test(name)) items.push(bulkString(name), bulkString(value));
    }
    return arrayReply(items);
  },
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
  select,
  command,
  config,
  bgrewriteaof,
};
