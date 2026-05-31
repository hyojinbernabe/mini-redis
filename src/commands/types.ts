import type { Store } from '../store.ts';

export interface CommandContext {
  store: Store;
}

export interface Command {
  // same rule as redis: positive means exactly that many args (including the name),
  // negative means at least that many
  arity: number;
  write: boolean;
  run(args: Buffer[], ctx: CommandContext): Buffer;
}

export class CommandError extends Error {}

export const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value';
export const NOT_INTEGER = 'ERR value is not an integer or out of range';
export const SYNTAX_ERROR = 'ERR syntax error';

const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

// strict like redis: no spaces, no plus sign, no leading zeros
export function parseBigInt(arg: Buffer): bigint {
  const text = arg.toString();
  if (!/^(0|-?[1-9]\d*)$/.test(text)) throw new CommandError(NOT_INTEGER);
  const value = BigInt(text);
  if (value < MIN_INT64 || value > MAX_INT64) throw new CommandError(NOT_INTEGER);
  return value;
}

export function parseInteger(arg: Buffer): number {
  const value = parseBigInt(arg);
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CommandError(NOT_INTEGER);
  }
  return Number(value);
}

export function fitsInt64(value: bigint): boolean {
  return value >= MIN_INT64 && value <= MAX_INT64;
}

export function getString(ctx: CommandContext, key: string): Buffer | null {
  const value = ctx.store.get(key);
  if (!value) return null;
  if (value.type !== 'string') throw new CommandError(WRONGTYPE);
  return value.data;
}

export function getList(ctx: CommandContext, key: string): Buffer[] | null {
  const value = ctx.store.get(key);
  if (!value) return null;
  if (value.type !== 'list') throw new CommandError(WRONGTYPE);
  return value.data;
}
