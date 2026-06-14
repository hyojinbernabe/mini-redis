// parser only benchmark, no network. feeds pipelined SET commands in
// socket sized chunks and reports how many commands per second get parsed.
// usage: node bench/parser.ts [pipeline] [valueSize]
import { RespParser, encodeCommand } from '../src/resp.ts';

const pipeline = Number(process.argv[2] ?? 16);
const valueSize = Number(process.argv[3] ?? 3);
const totalCommands = 1_000_000;
const chunkSize = 64 * 1024;

const value = 'x'.repeat(valueSize);
const batch = Buffer.concat(
  Array.from({ length: pipeline }, (_, i) => encodeCommand(['SET', `key:${i}`, value])),
);

// split each pipelined batch the way a socket might deliver it
const chunks: Buffer[] = [];
for (let offset = 0; offset < batch.length; offset += chunkSize) {
  chunks.push(batch.subarray(offset, offset + chunkSize));
}

function run(): number {
  const parser = new RespParser();
  let parsed = 0;
  const started = performance.now();
  while (parsed < totalCommands) {
    for (const chunk of chunks) parsed += parser.feed(chunk).length;
  }
  return parsed / ((performance.now() - started) / 1000);
}

run(); // warm up
const results = [run(), run(), run()];
const best = Math.max(...results);
console.log(
  `pipeline=${pipeline} value=${valueSize}B batch=${batch.length}B: ${Math.round(best).toLocaleString('en-US')} commands/sec`,
);
