# Benchmarks

## Setup

Everything ran on my laptop inside WSL2 (Kali Linux, 12 cores, 6 GB given to WSL), all over localhost so both servers had the same network path:

- Redis 8.0.5 (the one from the Kali packages), started with `redis-server --port 6399 --save "" --appendonly no`
- mini-redis with Node 20.19, compiled with `tsc` first since Node 20 can't run TypeScript directly, started with `node src/main.js --port 6399 --appendonly no`
- `redis-benchmark` from the same Redis 8.0.5 install

Persistence is off on both sides, so the numbers cover the protocol and command handling and leave the disk out of it.

Command, run once per setting:

```
redis-benchmark -p 6399 -t set,get -n 200000 -c 50 -q            # no pipelining
redis-benchmark -p 6399 -t set,get -n 200000 -c 50 -P 16 -q      # 16 commands per round trip
redis-benchmark -p 6399 -t set,get -n 200000 -c 50 -P 16 -d 1024 -q   # same, 1 KB values
```

Each server ran 3 rounds (taking turns, one server at a time). The numbers below are the median of the 3, in requests per second. WSL networking is noisy, runs moved around by 10 to 20 percent.

## Results

| Test | Redis 8.0.5 | mini-redis before | mini-redis after |
| --- | ---: | ---: | ---: |
| SET, no pipelining | 49,542 | 35,069 | 43,507 |
| GET, no pipelining | 52,356 | 39,968 | 46,425 |
| SET, `-P 16` | 784,314 | 182,149 | 247,831 |
| GET, `-P 16` | 775,194 | 192,123 | 242,424 |
| SET, `-P 16 -d 1024` | 636,943 | 91,116 | 216,920 |
| GET, `-P 16 -d 1024` | 709,220 | 166,389 | 216,920 |

Without pipelining both are mostly waiting on the network, so they end up close. With pipelining Redis is about 3x faster, which makes sense for a C server with years of tuning against a single Node process.

## Finding the slow part

The pipelined SET with 1 KB values was the worst case (91k vs 637k for Redis), so I profiled the server while `redis-benchmark` hammered it:

```
node --cpu-prof src/main.js --port 6399 --appendonly no
redis-benchmark -p 6399 -t set -n 200000 -c 50 -P 16 -d 1024 -q
```

The top function by self time, not counting idle, was Node's internal `slice` from `buffer.toString`, at 14% of all samples (about a quarter of the time the server was actually busy), plus a lot of garbage collection.

It came from this helper in the parser:

```ts
function readLine(buffer: Buffer, start: number) {
  const text = buffer.toString('latin1', start);
  const index = text.indexOf('\r\n');
  ...
}
```

To read a tiny header like `$1024`, it turned everything left in the buffer into a string. With 16 pipelined SETs of 1 KB each, that can be up to 16 KB converted for every header line, and each SET has 4 of them. The more data in one chunk, the worse it got, so the cost grew with pipeline depth and value size.

## The fix

- Find `\r` with `buffer.indexOf` and read the digits straight from the bytes, no strings at all.
- Walk the buffer with an offset and slice it once at the end of `feed()` instead of after every command.
- Skip `Buffer.concat` when there's no leftover data from the last chunk.

After the change the profile shows the parser at a couple of percent. The top item is now writing replies to the socket.

## Parser on its own

`pnpm bench:parser` feeds pipelined SET commands straight into the parser with no network, which shows the difference more clearly. Run on Windows with Node 24, best of 3:

```
node bench/parser.ts <pipeline> <value size>
```

| Pipeline, value size | before | after |
| --- | ---: | ---: |
| 1, 3 B | 904,894 | 1,210,696 |
| 16, 3 B | 972,236 | 1,443,071 |
| 100, 3 B | 746,719 | 1,350,627 |
| 1000, 3 B | 153,863 | 1,444,603 |
| 16, 1 KB | 321,642 | 925,406 |

Commands per second. Before the fix, deeper pipelines made it slower per command. After, it stays flat.
