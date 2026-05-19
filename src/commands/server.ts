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

export const serverCommands: Record<string, Command> = {
  ping,
  echo,
};
