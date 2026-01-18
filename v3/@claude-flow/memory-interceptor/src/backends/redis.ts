/**
 * Redis Memory Backend (Example)
 *
 * Example of a custom backend using Redis.
 * Requires: npm install ioredis
 *
 * Features:
 * - Distributed memory across Claude instances
 * - TTL support for automatic expiration
 * - Pub/sub for real-time sync
 */

import type { MemoryBackend, MemoryEntry, SearchResult, MemoryStats } from './interface.js';

export interface RedisBackendOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  keyPrefix?: string;
  defaultTTL?: number;
}

/**
 * Redis backend implementation
 *
 * Note: This is a template. To use:
 * 1. npm install ioredis
 * 2. Uncomment the Redis-specific code
 *
 * @example
 * ```typescript
 * const backend = new RedisBackend({
 *   url: 'redis://localhost:6379',
 *   keyPrefix: 'claude:memory:',
 * });
 * ```
 */
export class RedisBackend implements MemoryBackend {
  readonly name = 'redis';
  private options: RedisBackendOptions;
  // private client: Redis | null = null;  // Uncomment when using ioredis

  constructor(options: RedisBackendOptions = {}) {
    this.options = {
      host: 'localhost',
      port: 6379,
      keyPrefix: 'claude:memory:',
      ...options,
    };
  }

  private getKey(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  async init(): Promise<void> {
    // Uncomment when using ioredis:
    // const Redis = (await import('ioredis')).default;
    // this.client = new Redis({
    //   host: this.options.host,
    //   port: this.options.port,
    //   password: this.options.password,
    // });

    console.log('[RedisBackend] Initialized (template mode - install ioredis for actual Redis support)');
  }

  async close(): Promise<void> {
    // Uncomment when using ioredis:
    // if (this.client) {
    //   await this.client.quit();
    //   this.client = null;
    // }
  }

  async store(key: string, value: unknown, metadata?: Record<string, unknown>): Promise<void> {
    const entry: MemoryEntry = {
      key,
      value,
      metadata,
      timestamp: Date.now(),
    };

    const redisKey = this.getKey(key);
    const data = JSON.stringify(entry);

    // Uncomment when using ioredis:
    // if (this.options.defaultTTL) {
    //   await this.client!.setex(redisKey, this.options.defaultTTL, data);
    // } else {
    //   await this.client!.set(redisKey, data);
    // }

    // Template mode: just log
    console.log(`[RedisBackend] Would store: ${redisKey} = ${data.slice(0, 100)}...`);
  }

  async retrieve(key: string): Promise<MemoryEntry | null> {
    const redisKey = this.getKey(key);

    // Uncomment when using ioredis:
    // const data = await this.client!.get(redisKey);
    // if (!data) return null;
    // return JSON.parse(data);

    // Template mode
    console.log(`[RedisBackend] Would retrieve: ${redisKey}`);
    return null;
  }

  async delete(key: string): Promise<boolean> {
    const redisKey = this.getKey(key);

    // Uncomment when using ioredis:
    // const deleted = await this.client!.del(redisKey);
    // return deleted > 0;

    console.log(`[RedisBackend] Would delete: ${redisKey}`);
    return true;
  }

  async list(options?: { limit?: number; offset?: number; prefix?: string }): Promise<MemoryEntry[]> {
    const pattern = options?.prefix
      ? `${this.options.keyPrefix}${options.prefix}*`
      : `${this.options.keyPrefix}*`;

    // Uncomment when using ioredis:
    // const keys = await this.client!.keys(pattern);
    // const entries: MemoryEntry[] = [];
    //
    // for (const key of keys.slice(options?.offset || 0, (options?.offset || 0) + (options?.limit || 100))) {
    //   const data = await this.client!.get(key);
    //   if (data) entries.push(JSON.parse(data));
    // }
    //
    // return entries;

    console.log(`[RedisBackend] Would list: ${pattern}`);
    return [];
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
    // Redis doesn't have native full-text search
    // Options:
    // 1. Use RediSearch module
    // 2. Scan keys and filter in memory
    // 3. Maintain a separate search index

    // Uncomment for basic scan-based search:
    // const entries = await this.list({ limit: 1000 });
    // const results: SearchResult[] = [];
    //
    // for (const entry of entries) {
    //   const valueStr = JSON.stringify(entry.value);
    //   if (entry.key.includes(query) || valueStr.includes(query)) {
    //     results.push({
    //       key: entry.key,
    //       value: entry.value,
    //       score: 1,
    //     });
    //   }
    // }
    //
    // return results.slice(0, options?.limit || 10);

    console.log(`[RedisBackend] Would search: ${query}`);
    return [];
  }

  async stats(): Promise<MemoryStats> {
    // Uncomment when using ioredis:
    // const keys = await this.client!.keys(`${this.options.keyPrefix}*`);
    // let totalSize = 0;
    //
    // for (const key of keys.slice(0, 100)) { // Sample first 100
    //   const len = await this.client!.strlen(key);
    //   totalSize += len;
    // }
    //
    // return {
    //   totalEntries: keys.length,
    //   totalSizeBytes: totalSize * (keys.length / 100), // Estimate
    // };

    return {
      totalEntries: 0,
      totalSizeBytes: 0,
    };
  }

  async clear(namespace?: string): Promise<void> {
    const pattern = namespace
      ? `${this.options.keyPrefix}${namespace}:*`
      : `${this.options.keyPrefix}*`;

    // Uncomment when using ioredis:
    // const keys = await this.client!.keys(pattern);
    // if (keys.length > 0) {
    //   await this.client!.del(...keys);
    // }

    console.log(`[RedisBackend] Would clear: ${pattern}`);
  }

  async health(): Promise<boolean> {
    // Uncomment when using ioredis:
    // try {
    //   await this.client!.ping();
    //   return true;
    // } catch {
    //   return false;
    // }

    return true;
  }
}
