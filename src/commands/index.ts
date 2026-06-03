import { errorReply } from '../resp.ts';
import { hashCommands } from './hashes.ts';
import { keyCommands } from './keys.ts';
import { listCommands } from './lists.ts';
import { serverCommands } from './server.ts';
import { stringCommands } from './strings.ts';
import { type Command, type CommandContext, CommandError } from './types.ts';

export type { CommandContext } from './types.ts';

const commands = new Map<string, Command>(
  Object.entries({
    ...serverCommands,
    ...stringCommands,
    ...keyCommands,
    ...listCommands,
    ...hashCommands,
  }),
);

function unknownCommand(args: Buffer[]): string {
  const preview = args
    .slice(1)
    .map((arg) => `'${arg.toString()}' `)
    .join('');
  return `ERR unknown command '${args[0].toString()}', with args beginning with: ${preview}`;
}

// runs one command and returns the encoded reply. errors become RESP error replies
export function execute(args: Buffer[], ctx: CommandContext): Buffer {
  const name = args[0].toString().toLowerCase();
  const command = commands.get(name);
  if (!command) return errorReply(unknownCommand(args));

  const arityOk =
    command.arity > 0 ? args.length === command.arity : args.length >= -command.arity;
  if (!arityOk) return errorReply(`ERR wrong number of arguments for '${name}' command`);

  try {
    const reply = command.run(args, ctx);
    if (command.write && ctx.aof) {
      ctx.aof.append([args]);
    }
    return reply;
  } catch (error) {
    if (error instanceof CommandError) return errorReply(error.message);
    throw error;
  }
}
