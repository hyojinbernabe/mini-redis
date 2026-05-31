import { NULL_BULK, arrayReply, bulkString, integerReply } from '../resp.ts';
import { type Command, type CommandContext, getList, parseInteger } from './types.ts';

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
  const list = getList(ctx, args[1].toString());
  if (!list) return NULL_BULK;
  return bulkString(fromFront ? list.shift()! : list.pop()!);
}

const lpush: Command = { arity: -3, write: true, run: (args, ctx) => push(ctx, args, true) };
const rpush: Command = { arity: -3, write: true, run: (args, ctx) => push(ctx, args, false) };
const lpop: Command = { arity: 2, write: true, run: (args, ctx) => pop(ctx, args, true) };
const rpop: Command = { arity: 2, write: true, run: (args, ctx) => pop(ctx, args, false) };

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
