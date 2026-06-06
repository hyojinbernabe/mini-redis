import fs from 'node:fs';
import { execute, type CommandContext } from './commands/index.ts';
import { RespParser, encodeCommand } from './resp.ts';

export type FsyncPolicy = 'always' | 'everysec' | 'no';

// append only file: every write command gets logged in RESP format,
// and on startup the file is replayed to rebuild the data
export class AppendOnlyFile {
  readonly path: string;
  readonly fsyncPolicy: FsyncPolicy;
  private fd: number;
  private pending: Buffer[] = [];
  private unsynced = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(path: string, fsyncPolicy: FsyncPolicy) {
    this.path = path;
    this.fsyncPolicy = fsyncPolicy;
    this.fd = fs.openSync(path, 'a');

    if (fsyncPolicy === 'everysec') {
      this.timer = setInterval(() => this.fsyncIfNeeded(), 1000);
      this.timer.unref();
    }
  }

  append(commands: Array<Array<Buffer | string>>): void {
    for (const command of commands) this.pending.push(encodeCommand(command));
  }

  // the server calls this once per batch of commands, before sending the replies.
  // so with "always" a client never gets OK for a write that isn't on disk yet
  flush(): void {
    if (this.pending.length === 0) return;
    fs.writeSync(this.fd, Buffer.concat(this.pending));
    this.pending = [];

    if (this.fsyncPolicy === 'always') fs.fsyncSync(this.fd);
    else if (this.fsyncPolicy === 'everysec') this.unsynced = true;
    // "no" leaves it to the OS
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
  }

  private fsyncIfNeeded(): void {
    if (!this.unsynced) return;
    fs.fsyncSync(this.fd);
    this.unsynced = false;
  }
}

// replays the file into ctx.store. returns how many commands were loaded
export function loadAof(path: string, ctx: CommandContext): number {
  if (!fs.existsSync(path)) return 0;

  const data = fs.readFileSync(path);
  const parser = new RespParser();
  const commands = parser.feed(data);
  const replayCtx: CommandContext = { ...ctx, aof: null };

  ctx.store.loading = true;
  try {
    for (const args of commands) {
      const reply = execute(args, replayCtx);
      if (reply[0] === 0x2d) {
        console.warn(`aof: "${args[0]}" failed during replay: ${reply.toString().trim()}`);
      }
    }
  } finally {
    ctx.store.loading = false;
  }

  // the server probably died in the middle of a write. keep what we have and
  // cut the broken tail off so new commands don't get appended after garbage
  if (parser.pendingBytes > 0) {
    console.warn(`aof: ignoring ${parser.pendingBytes} bytes of incomplete data at the end`);
    fs.truncateSync(path, data.length - parser.pendingBytes);
  }

  return commands.length;
}
