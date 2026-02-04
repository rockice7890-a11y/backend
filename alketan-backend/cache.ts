import Redis from 'ioredis'
import { logDebug, logError } from './logger'

// إعداد Redis Client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  maxRetriesPerRequest: 3,
})

redis.on('error', (err) => {
  logError('Redis connection error', err)
})

redis.on('connect', () => {
  logDebug('Redis connected successfully')
})

/**
 * الحصول على بيانات من Cache أو قاعدة البيانات
 */
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600 // 1 ساعة افتراضياً
): Promise<T> {
  try {
    // محاولة الحصول من Cache
    const cached = await redis.get(key)
    
    if (cached) {
      logDebug(`Cache hit: ${key}`)
      return JSON.parse(cached) as T
    }

    // إذا لم تكن في Cache، جلب من قاعدة البيانات
    logDebug(`Cache miss: ${key}`)
    const data = await fetcher()
    
    // حفظ في Cache
    await redis.setex(key, ttl, JSON.stringify(data))
    
    return data
  } catch (error) {
    logError(`Cache error for key: ${key}`, error)
    // في حالة خطأ في Cache، جلب من قاعدة البيانات مباشرة
    return await fetcher()
  }
}

/**
 * حذف من Cache
 */
export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
      logDebug(`Cache invalidated: ${pattern} (${keys.length} keys)`)
    }
  } catch (error) {
    logError(`Cache invalidation error for pattern: ${pattern}`, error)
  }
}

/**
 * حذف مفتاح محدد من Cache
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    await redis.del(key)
    logDebug(`Cache deleted: ${key}`)
  } catch (error) {
    logError(`Cache deletion error for key: ${key}`, error)
  }
}

/**
 * تحديث Cache
 */
export async function setCache<T>(
  key: string,
  data: T,
  ttl: number = 3600
): Promise<void> {
  try {
    await redis.setex(key, ttl, JSON.stringify(data))
    logDebug(`Cache set: ${key}`)
  } catch (error) {
    logError(`Cache set error for key: ${key}`, error)
  }
}

/**
 * Cache Keys Patterns
 */
export const CacheKeys = {
  hotel: (id: string) => `hotel:${id}`,
  hotels: (filters: string) => `hotels:${filters}`,
  room: (id: string) => `room:${id}`,
  rooms: (hotelId: string, filters?: string) => `rooms:${hotelId}${filters ? `:${filters}` : ''}`,
  booking: (id: string) => `booking:${id}`,
  bookings: (filters: string) => `bookings:${filters}`,
  user: (id: string) => `user:${id}`,
  reviews: (hotelId: string) => `reviews:${hotelId}`,
  search: (query: string) => `search:${query}`,
}

export { redis }

