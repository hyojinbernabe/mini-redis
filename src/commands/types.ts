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

export function getString(ctx: CommandContext, key: string): Buffer | null {
  const value = ctx.store.get(key);
  if (!value) return null;
  if (value.type !== 'string') throw new CommandError(WRONGTYPE);
  return value.data;
}
