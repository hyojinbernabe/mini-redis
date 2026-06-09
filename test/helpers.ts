import { type CommandContext, execute } from '../src/commands/index.ts';
import { Store } from '../src/store.ts';

// a fake clock so expiry tests don't need to sleep
export class FakeClock {
  time = 1_700_000_000_000;
  now = () => this.time;
  advance(milliseconds: number) {
    this.time += milliseconds;
  }
}

export function createContext(clock = new FakeClock()): CommandContext {
  return { store: new Store(clock.now), aof: null, config: {} };
}

// runs a command and returns the raw RESP reply as a string
export function run(ctx: CommandContext, ...args: string[]): string {
  return execute(
    args.map((arg) => Buffer.from(arg)),
    ctx,
  ).toString();
}
