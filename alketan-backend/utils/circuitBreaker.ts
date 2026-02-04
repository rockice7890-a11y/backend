import { getRedis, redisUtils } from '@/lib/redis'

// حالات Circuit Breaker
export enum CircuitState {
  CLOSED = 'CLOSED',       //正常工作
  OPEN = 'OPEN',           // مفتوح - يرفض الطلبات فوراً
  HALF_OPEN = 'HALF_OPEN', // نصف مفتوح - يختبر الخدمة
}

// إعدادات Circuit Breaker
export interface CircuitBreakerConfig {
  failureThreshold: number      // عدد الإخفاقات لفتح الدائرة (افتراضي: 5)
  successThreshold: number      // عدد النجاحات لإغلاق الدائرة (افتراضي: 2)
  timeout: number               // وقت الانتظار قبل إعادة المحاولة بالثواني (افتراضي: 30)
  monitoringWindow: number      // نافذة المراقبة بالثواني (افتراضي: 60)
}

// إحصائيات Circuit Breaker
export interface CircuitBreakerStats {
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailure: string | null
  lastSuccess: string | null
  nextRetry: string | null
  totalRequests: number
  totalFailures: number
  totalSuccesses: number
}

// بيانات الخدمة في Redis
interface ServiceData {
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailure: string
  lastSuccess: string
  nextRetry: string
}

// فئة Circuit Breaker
export class CircuitBreaker {
  private serviceName: string
  private config: CircuitBreakerConfig
  private redisPrefix: string

  constructor(serviceName: string, config?: Partial<CircuitBreakerConfig>) {
    this.serviceName = serviceName
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 2,
      timeout: config?.timeout ?? 30,
      monitoringWindow: config?.monitoringWindow ?? 60,
    }
    this.redisPrefix = `circuit:${this.serviceName}:`
  }

  // الحصول على مفتاح Redis
  private getKey(key: string): string {
    return `${this.redisPrefix}${key}`
  }

  // الحصول على الحالة الحالية
  async getState(): Promise<CircuitState> {
    const redis = getRedis()
    if (!redis) {
      // إذا لم يتوفر Redis، نستخدم وضعCLOSED فقط
      return CircuitState.CLOSED
    }

    try {
      const state = await redisUtils.get(this.getKey('state')) as CircuitState
      return state || CircuitState.CLOSED
    } catch (error) {
      console.error('Failed to get circuit breaker state:', error)
      return CircuitState.CLOSED
    }
  }

  // الحصول على إحصائيات الدائرة
  async getStats(): Promise<CircuitBreakerStats> {
    const redis = getRedis()
    if (!redis) {
      return {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailure: null,
        lastSuccess: null,
        nextRetry: null,
        totalRequests: 0,
        totalFailures: 0,
        totalSuccesses: 0,
      }
    }

    try {
      const data = await redisUtils.hgetall(this.getKey('data'))
      
      if (!data) {
        return {
          state: CircuitState.CLOSED,
          failureCount: 0,
          successCount: 0,
          lastFailure: null,
          lastSuccess: null,
          nextRetry: null,
          totalRequests: 0,
          totalFailures: 0,
          totalSuccesses: 0,
        }
      }

      const state = (await this.getState()) || CircuitState.CLOSED
      const nextRetry = await redisUtils.get(this.getKey('nextRetry'))

      return {
        state,
        failureCount: parseInt(data.failureCount || '0'),
        successCount: parseInt(data.successCount || '0'),
        lastFailure: data.lastFailure || null,
        lastSuccess: data.lastSuccess || null,
        nextRetry: nextRetry || null,
        totalRequests: parseInt(data.totalRequests || '0'),
        totalFailures: parseInt(data.totalFailures || '0'),
        totalSuccesses: parseInt(data.totalSuccesses || '0'),
      }
    } catch (error) {
      console.error('Failed to get circuit breaker stats:', error)
      return {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailure: null,
        lastSuccess: null,
        nextRetry: null,
        totalRequests: 0,
        totalFailures: 0,
        totalSuccesses: 0,
      }
    }
  }

  // تنفيذ دالة مع حماية Circuit Breaker
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: (error: Error) => Promise<T>
  ): Promise<T> {
    const state = await this.getState()

    // إذا كانت الدائرة مفتوحة، نرفض الطلب فوراً
    if (state === CircuitState.OPEN) {
      const nextRetry = await redisUtils.get(this.getKey('nextRetry'))
      
      // إذا حان وقت إعادة المحاولة، نفتح نصف
      if (nextRetry && new Date(nextRetry) <= new Date()) {
        await this.setState(CircuitState.HALF_OPEN)
      } else {
        // الدائرة لا تزال مفتوحة
        const error = new Error(`Circuit breaker is OPEN for ${this.serviceName}`)
        if (fallback) {
          return await fallback(error)
        }
        throw error
      }
    }

    try {
      // تنفيذ الدالة
      const result = await fn()
      
      // نجاح - تحديث الإحصائيات
      await this.recordSuccess()
      
      return result
    } catch (error) {
      // فشل - تحديث الإحصائيات
      await this.recordFailure()
      
      const stats = await this.getStats()
      
      // إذا وصلت للفشل للحد، افتح الدائرة
      if (stats.failureCount >= this.config.failureThreshold) {
        await this.open()
      }

      if (fallback) {
        return await fallback(error as Error)
      }
      throw error
    }
  }

  // تسجيل نجاح
  private async recordSuccess(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      const now = new Date().toISOString()
      const state = await this.getState()

      // تحديث العدادات
      await redisUtils.hset(this.getKey('data'), 'successCount', '1')
      await redisUtils.hset(this.getKey('data'), 'lastSuccess', now)
      
      // زيادة إجمالي النجاحات
      const totalSuccesses = await redisUtils.hget(this.getKey('data'), 'totalSuccesses')
      await redisUtils.hset(this.getKey('data'), 'totalSuccesses', String((parseInt(totalSuccesses || '0') + 1)))

      // إذا كانت الحالة HALF_OPEN ونجحت، أغلق الدائرة
      if (state === CircuitState.HALF_OPEN) {
        const successCount = parseInt(await redisUtils.hget(this.getKey('data'), 'successCount') || '0')
        
        if (successCount >= this.config.successThreshold) {
          await this.close()
        }
      }
    } catch (error) {
      console.error('Failed to record success:', error)
    }
  }

  // تسجيل فشل
  private async recordFailure(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      const now = new Date().toISOString()

      await redisUtils.hset(this.getKey('data'), 'failureCount', '1')
      await redisUtils.hset(this.getKey('data'), 'lastFailure', now)
      
      // زيادة إجمالي الإخفاقات
      const totalFailures = await redisUtils.hget(this.getKey('data'), 'totalFailures')
      await redisUtils.hset(this.getKey('data'), 'totalFailures', String((parseInt(totalFailures || '0') + 1)))

      // إعادة تعيين نجاحات
      await redisUtils.hset(this.getKey('data'), 'successCount', '0')
    } catch (error) {
      console.error('Failed to record failure:', error)
    }
  }

  // تعيين الحالة
  private async setState(state: CircuitState): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      await redisUtils.setex(this.getKey('state'), this.config.timeout, state)
    } catch (error) {
      console.error('Failed to set circuit breaker state:', error)
    }
  }

  // فتح الدائرة (OPEN)
  private async open(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      const nextRetry = new Date(Date.now() + this.config.timeout * 1000).toISOString()
      
      await redisUtils.setex(this.getKey('state'), this.config.timeout, CircuitState.OPEN)
      await redisUtils.setex(this.getKey('nextRetry'), this.config.timeout, nextRetry)
      
      console.warn(`Circuit breaker OPENED for ${this.serviceName}`)
    } catch (error) {
      console.error('Failed to open circuit breaker:', error)
    }
  }

  // إغلاق الدائرة (CLOSED)
  async close(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      await redisUtils.del(this.getKey('state'))
      await redisUtils.del(this.getKey('nextRetry'))
      await redisUtils.hset(this.getKey('data'), 'failureCount', '0')
      await redisUtils.hset(this.getKey('data'), 'successCount', '0')
      
      console.info(`Circuit breaker CLOSED for ${this.serviceName}`)
    } catch (error) {
      console.error('Failed to close circuit breaker:', error)
    }
  }

  // إعادة تعيين الدائرة
  async reset(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      await redisUtils.del(this.getKey('state'))
      await redisUtils.del(this.getKey('nextRetry'))
      await redisUtils.del(this.getKey('data'))
      
      console.info(`Circuit breaker RESET for ${this.serviceName}`)
    } catch (error) {
      console.error('Failed to reset circuit breaker:', error)
    }
  }
}

// مدير Circuit Breaker للخدمات المتعددة
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map()

  // الحصول على Circuit Breaker لخدمة معينة
  getBreaker(serviceName: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, config))
    }
    return this.breakers.get(serviceName)!
  }

  // الحصول على جميع الإحصائيات
  async getAllStats(): Promise<Record<string, CircuitBreakerStats>> {
    const stats: Record<string, CircuitBreakerStats> = {}
    
    for (const [name, breaker] of this.breakers) {
      stats[name] = await breaker.getStats()
    }
    
    return stats
  }

  // إعادة تعيين جميع الدوائر
  async resetAll(): Promise<void> {
    for (const [, breaker] of this.breakers) {
      await breaker.reset()
    }
  }
}

// إنشاء مدير عام
export const circuitBreakerManager = new CircuitBreakerManager()

// Circuit Breaker جاهز للخدمات الشائعة
export const breakers = {
  redis: circuitBreakerManager.getBreaker('redis', {
    failureThreshold: 3,
    timeout: 10,
  }),
  database: circuitBreakerManager.getBreaker('database', {
    failureThreshold: 5,
    timeout: 30,
  }),
  external: circuitBreakerManager.getBreaker('external-api', {
    failureThreshold: 3,
    timeout: 60,
  }),
}
