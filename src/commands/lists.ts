import { NULL_ARRAY, NULL_BULK, arrayReply, bulkString, integerReply } from '../resp.ts';
import { type Command, type CommandContext, CommandError, getList, parseInteger } from './types.ts';

function push(ctx: CommandContext, args: Buffer[], toFront: boolean): Buffer {
  const key = args[1].toString();
  let list = getList(ctx, key);
  if (!list) {
    list = [];
    ctx.store.put(key, { type: 'list', data: list });
  }

  for (const item of args.slice(2)) {
    if (toFront) list.unshift(item);
    else list.push(item);
  }
  return integerReply(list.length);
}

function pop(ctx: CommandContext, args: Buffer[], fromFront: boolean): Buffer {
  const key = args[1].toString();
  if (args.length > 3) throw new CommandError(`ERR wrong number of arguments for '${fromFront ? 'lpop' : 'rpop'}' command`);

  const count = args.length === 3 ? parseInteger(args[2]) : null;
  if (count !== null && count < 0) throw new CommandError('ERR value is out of range, must be positive');

  const list = getList(ctx, key);
  if (!list) return count === null ? NULL_BULK : NULL_ARRAY;

  if (count === 0) return arrayReply([]);

  const amount = count ?? 1;
  const taken = fromFront
    ? list.splice(0, amount)
    : list.splice(Math.max(0, list.length - amount)).reverse();
  // redis never keeps empty lists around
  if (list.length === 0) ctx.store.delete(key);

  if (count === null) return bulkString(taken[0]);
  return arrayReply(taken.map((item) => bulkString(item)));
}

const lpush: Command = { arity: -3, write: true, run: (args, ctx) => push(ctx, args, true) };
const rpush: Command = { arity: -3, write: true, run: (args, ctx) => push(ctx, args, false) };
const lpop: Command = { arity: -2, write: true, run: (args, ctx) => pop(ctx, args, true) };
const rpop: Command = { arity: -2, write: true, run: (args, ctx) => pop(ctx, args, false) };

const lrange: Command = {
  arity: 4,
  write: false,
  run(args, ctx) {
    const list = getList(ctx, args[1].toString()) ?? [];
    let start = parseInteger(args[2]);
    let end = parseInteger(args[3]);

    // negative indexes count from the end, -1 is the last item
    if (start < 0) start = Math.max(0, list.length + start);
    if (end < 0) end = list.length + end;
    end = Math.min(end, list.length - 1);

    if (start > end) return arrayReply([]);
    return arrayReply(list.slice(start, end + 1).map((item) => bulkString(item)));
  },
};

const llen: Command = {
  arity: 2,
  write: false,
  run(args, ctx) {
    return integerReply(getList(ctx, args[1].toString())?.length ?? 0);
  },
};

export const listCommands: Record<string, Command> = { lpush, rpush, lpop, rpop, lrange, llen };
