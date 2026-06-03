import { parseArgs } from 'node:util';
import type { FsyncPolicy } from './aof.ts';
import { startServer } from './server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '6379' },
    host: { type: 'string', default: '127.0.0.1' },
    appendonly: { type: 'string', default: 'yes' },
    appendfilename: { type: 'string', default: 'appendonly.aof' },
    appendfsync: { type: 'string', default: 'everysec' },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid --port: ${values.port}`);
  process.exit(1);
}

if (!['always', 'everysec', 'no'].includes(values.appendfsync)) {
  console.error('--appendfsync must be always, everysec or no');
  process.exit(1);
}

const appendOnly = values.appendonly === 'yes';

const server = await startServer({
  port,
  host: values.host,
  appendOnly,
  appendFilename: values.appendfilename,
  appendFsync: values.appendfsync as FsyncPolicy,
});

if (appendOnly) {
  console.log(`loaded ${server.loadedCommands} commands from ${values.appendfilename}`);
}
console.log(`mini-redis listening on ${values.host}:${server.port}`);

async function shutdown() {
  console.log('shutting down');
  await server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
