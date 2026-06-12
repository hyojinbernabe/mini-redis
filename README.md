# mini-redis

![ci](https://github.com/hyojinbernabe/mini-redis/actions/workflows/ci.yml/badge.svg)

A small Redis-compatible server I wrote in TypeScript to understand how Redis works on the inside. It speaks the real Redis protocol (RESP), so the official `redis-cli` and `redis-benchmark` can talk to it. No Redis libraries, just Node's `net` module.

```
$ redis-cli
127.0.0.1:6379> SET user:1 hyojin EX 60
OK
127.0.0.1:6379> GET user:1
"hyojin"
127.0.0.1:6379> TTL user:1
(integer) 60
127.0.0.1:6379> INCR visits
(integer) 1
127.0.0.1:6379> INCRBY visits 10
(integer) 11
127.0.0.1:6379> RPUSH queue a b c
(integer) 3
127.0.0.1:6379> LRANGE queue 0 -1
1) "a"
2) "b"
3) "c"
```

## Running it

You need pnpm and Node 22.18 or newer. Node runs the TypeScript files directly, so there is no build step.

```
pnpm install
pnpm start
```

It listens on `127.0.0.1:6379`, and you connect with `redis-cli` the same way you would to normal Redis.

Options:

```
pnpm start --port 6380
pnpm start --appendonly no                  # keep everything in memory only
pnpm start --appendfsync always             # always | everysec (default) | no
pnpm start --appendfilename data.aof
```

Tests: `pnpm test`

## What it supports

- Strings: `SET` (with `EX`, `PX`, `PXAT`, `NX`, `XX`, `KEEPTTL`), `GET`, `APPEND`, `STRLEN`, `INCR`, `DECR`, `INCRBY`, `DECRBY`, `MGET`, `MSET`
- Keys: `DEL`, `EXISTS`, `TYPE`, `KEYS` (glob patterns), `DBSIZE`, `FLUSHALL`
- Expiry: `EXPIRE`, `PEXPIRE`, `PEXPIREAT`, `TTL`, `PTTL`, `PERSIST`
- Lists: `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LRANGE`, `LLEN`
- Hashes: `HSET`, `HGET`, `HDEL`, `HGETALL`
- Server: `PING`, `ECHO`, `SELECT 0`, `CONFIG GET`, `BGREWRITEAOF`, `QUIT`

Error replies match Redis (`WRONGTYPE`, wrong number of arguments, unknown command, not an integer), so clients handle them the same way.

## How it works

Every connection gets its own parser in `src/resp.ts`. TCP hands you a stream of bytes with no message boundaries, so one `data` event can hold half a command or fifty of them. The parser keeps leftover bytes until the rest arrives and returns every complete command it finds. All the replies for one batch go out in a single `socket.write`, and that is most of why pipelining is fast.

The store (`src/store.ts`) is a `Map` of keys to values plus a second `Map` of expiry times. Redis splits it the same way.

Keys expire two ways, also copied from Redis. Every read checks whether the key has expired and deletes it if so (lazy expiry). On top of that, 10 times a second the server looks at 20 keys that have a TTL, deletes the expired ones, and goes again if more than a quarter of them were expired (active expiry). Without the second part, a key nobody reads again would sit in memory forever.

Persistance lives in `src/aof.ts`. Every write command is appended to `appendonly.aof` in RESP format, and the file gets replayed on startup. Commands with relative times (`SET ... EX 60`, `EXPIRE`) are logged with an absolute timestamp instead, otherwise every restart would reset the TTLs. `appendfsync` decides how often the file is flushed to disk: after every write, once a second, or whenever the OS gets to it. `BGREWRITEAOF` shrinks the file down to one command per key.

## What I learned

- A command can arrive in pieces over TCP, so the parser has to hold on to leftover bytes. Testing a command split at every possible byte was the easiest way to trust it.
- Replaying a log is harder than writing it. Times have to be absolute, and keys can't expire in the middle of a replay (a `PERSIST` later in the file would find nothing to persist).

## What I'd do next

- A real background rewrite. Redis forks so `BGREWRITEAOF` doesn't block. Here it blocks while it writes, which is fine for small datasets only.
- A proper deque for lists. `LPUSH` uses `Array.unshift`, which is O(n).
- Backpressure: if a client stops reading replies, the server keeps buffering them.
- Pub/sub and sorted sets.
