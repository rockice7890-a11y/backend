import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

// إعداد Redis Client
let redisInstance: Redis | null = null

export function getRedis(): Redis | null {
  if (redisInstance) return redisInstance

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      redisInstance = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
      return redisInstance
    } catch (error) {
      console.error('Failed to initialize Redis:', error)
      return null
    }
  }

  console.warn('Redis environment variables not set')
  return null
}

// التحقق من اتصال Redis
export async function checkRedisConnection(): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  try {
    await redis.ping()
    return true
  } catch (error) {
    console.error('Redis connection check failed:', error)
    return false
  }
}

// الحصول على Rate Limiter
export function getRateLimiter(limit: number, windowSeconds: number, prefix: string) {
  const redis = getRedis()
  if (!redis) return null

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: true,
    prefix,
  })
}

// Utility functions للـ Redis
export const redisUtils = {
  // Set with expiry
  async setex(key: string, seconds: number, value: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.setex(key, seconds, value)
    }
  },

  // Get value
  async get(key: string): Promise<string | null> {
    const redis = getRedis()
    return redis ? await redis.get(key) : null
  },

  // Delete key
  async del(key: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.del(key)
    }
  },

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    const redis = getRedis()
    if (!redis) return false
    const result = await redis.exists(key)
    return result === 1
  },

  // Increment counter
  async incr(key: string): Promise<number> {
    const redis = getRedis()
    return redis ? await redis.incr(key) : 0
  },

  // Set hash
  async hset(key: string, field: string, value: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.hset(key, { [field]: value })
    }
  },

  // Get hash field
  async hget(key: string, field: string): Promise<string | null> {
    const redis = getRedis()
    return redis ? await redis.hget(key, field) : null
  },

  // Get all hash fields
  async hgetall(key: string): Promise<Record<string, string> | null> {
    const redis = getRedis()
    return redis ? await redis.hgetall(key) : null
  },

  // Delete hash field
  async hdel(key: string, field: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.hdel(key, field)
    }
  },

  // Add to set
  async sadd(key: string, ...members: string[]): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.sadd(key, members as any)
    }
  },

  // Get set members
  async smembers(key: string): Promise<string[]> {
    const redis = getRedis()
    return redis ? await redis.smembers(key) : []
  },

  // Remove from set
  async srem(key: string, ...members: string[]): Promise<void> {
    const redis = getRedis()
    if (redis) {
      await redis.srem(key, members as any)
    }
  },
}

export { Redis, Ratelimit }
