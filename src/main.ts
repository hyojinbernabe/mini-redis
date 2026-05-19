import { parseArgs } from 'node:util';
import { startServer } from './server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '6379' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid --port: ${values.port}`);
  process.exit(1);
}

const server = await startServer({ port, host: values.host });
console.log(`mini-redis listening on ${values.host}:${server.port}`);

async function shutdown() {
  console.log('shutting down');
  await server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
