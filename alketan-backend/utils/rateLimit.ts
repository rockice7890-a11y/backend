import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { verifyAccessToken, extractTokenFromHeader } from '@/utils/auth'

// إعداد Redis - lazy initialization للتوافق مع Edge Runtime
let redisInstance: Redis | null = null

function getRedis(): Redis | null {
  if (redisInstance) return redisInstance

  if (process.env.UPSTASH_REDIS_REST_URL) {
    try {
      redisInstance = Redis.fromEnv()
      return redisInstance
    } catch (error) {
      console.error('Failed to initialize Redis for rate limiting:', error)
      return null
    }
  }

  console.warn('UPSTASH_REDIS_REST_URL not set. Rate limiting is in strict mode - requests will be rejected.')
  return null
}

// إنشاء limiter مع lazy initialization لتحسين الأداء
function createLimiter(prefix: string, limit: number, window: string) {
  let cachedLimiter: Ratelimit | null = null
  
  return {
    limit: async (identifier: string) => {
      const redis = getRedis()
      if (!redis) {
        return { 
          success: false, 
          limit, 
          remaining: 0, 
          reset: Date.now() + 60000 
        }
      }

      // إعادة إنشاء limiter فقط إذا لم يكن موجوداً
      if (!cachedLimiter) {
        cachedLimiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(limit, window as any),
          analytics: true,
          prefix: `@upstash/ratelimit/${prefix}`,
        })
      }

      return await cachedLimiter.limit(identifier)
    }
  }
}

// Rate Limiters مع إعدادات مُحسنة
export const apiRateLimit = createLimiter('api', 100, '1 m')
export const authRateLimit = createLimiter('auth', 200, '15 m')
export const searchRateLimit = createLimiter('search', 200, '1 m')
export const bookingRateLimit = createLimiter('booking', 200, '5 m')

// Rate Limiter أكثر صرامة للمستخدمين ذوي الصلاحيات العالية
export const adminRateLimit = createLimiter('admin', 50, '1 m')

// دالة مساعدة للحصول على User ID من الطلب (للـ API Routes فقط)
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  try {
    const authHeader = request.headers.get('authorization')
    const token = extractTokenFromHeader(authHeader)
    
    if (token) {
      const decoded = await verifyAccessToken(token)
      if (decoded && decoded.userId) {
        return decoded.userId
      }
    }
    
    // محاولة الحصول على refresh token من الكوكيز
    const refreshToken = request.cookies.get('__Secure-refreshToken')?.value
    if (refreshToken) {
      // استيراد الدالة هنا لتجنب circular dependency
      const { verifyRefreshToken } = await import('@/utils/auth')
      const decoded = await verifyRefreshToken(refreshToken)
      if (decoded && decoded.userId) {
        return decoded.userId
      }
    }
    
    return null
  } catch (error) {
    return null
  }
}

// دالة مساعدة للحصول على معرف Rate Limit هجين (User ID + IP)
export async function getRateLimitIdentifier(request: NextRequest): Promise<string> {
  // أولاً: محاولة الحصول على User ID للمستخدمين المُصادق عليهم
  const userId = await getUserIdFromRequest(request)
  
  if (userId) {
    // للمستخدمين المُصادق عليهم: استخدام User ID + IP للتدقيق
    const ip = getClientIP(request)
    return `user:${userId}:ip:${ip}`
  }
  
  // ثانياً: للزوار: استخدام IP + fingerprint المتصفح
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || ''
  const fingerprint = generateSimpleFingerprint(userAgent)
  
  return `anon:${ip}:${fingerprint}`
}

// دالة مساعدة للحصول على IP العميل
export function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  if (realIp) {
    return realIp
  }
  if (cfConnectingIp) {
    return cfConnectingIp
  }
  
  return 'unknown'
}

// توليد fingerprint بسيط للمتصفح
function generateSimpleFingerprint(userAgent: string): string {
  // استخراج معلومات أساسية من user-agent
  const parts: string[] = []
  
  if (/mobile/i.test(userAgent)) {
    parts.push('mobile')
  } else if (/tablet/i.test(userAgent)) {
    parts.push('tablet')
  } else {
    parts.push('desktop')
  }
  
  if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) {
    parts.push('chrome')
  } else if (/firefox/i.test(userAgent)) {
    parts.push('firefox')
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    parts.push('safari')
  } else if (/edge/i.test(userAgent)) {
    parts.push('edge')
  }
  
  return parts.join('-')
}

// دالة مساعدة للحصول على limiter المناسب بناءً على المسار
export function getRateLimiterForPath(pathname: string): typeof apiRateLimit {
  if (pathname.startsWith('/api/auth/')) {
    return authRateLimit
  }
  if (pathname.startsWith('/api/search/')) {
    return searchRateLimit
  }
  if (pathname.startsWith('/api/bookings') || pathname.startsWith('/api/auto-checkout')) {
    return bookingRateLimit
  }
  if (pathname.startsWith('/api/admin/')) {
    return adminRateLimit
  }
  return apiRateLimit
}

// Helper function للتحقق من Rate Limit
export async function checkRateLimit(
  identifier: string,
  limiter: { limit: (id: string) => Promise<{ success: boolean; limit: number; remaining: number; reset: number }> }
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  try {
    const result = await limiter.limit(identifier)
    return result
  } catch (error) {
    // Fail Closed - رفض الطلب عند حدوث خطأ في Rate Limiting
    console.error('Rate limit check failed:', error)
    
    return {
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 900000, // 15 دقيقة
    }
  }
}

// Middleware للـ Rate Limiting مُحسّن
const RATE_LIMIT_ERROR_MESSAGE = 'نظام الحماية من محاولات الاختراق نشط حالياً. يرجى المحاولة مرة أخرى لاحقاً.'

export async function rateLimitMiddleware(
  request: NextRequest,
  limiter?: { limit: (id: string) => Promise<{ success: boolean; limit: number; remaining: number; reset: number }> },
  customIdentifier?: string
): Promise<NextResponse | null> {
  try {
    // استخدام limiter المُمرر أو تحديده بناءً على المسار
    const selectedLimiter = limiter || getRateLimiterForPath(request.nextUrl.pathname)
    
    // استخدام المعرف المُمرر أو حسابه تلقائياً
    const identifier = customIdentifier || await getRateLimitIdentifier(request)

    const { success, limit, remaining, reset } = await checkRateLimit(identifier, selectedLimiter)

    if (!success) {
      console.warn(`Rate limit exceeded for ${identifier} on path: ${request.nextUrl.pathname}`)

      const response = NextResponse.json(
        {
          error: RATE_LIMIT_ERROR_MESSAGE,
          retryAfter: Math.ceil((reset - Date.now()) / 1000),
          code: 'RATE_LIMIT_EXCEEDED',
        },
        { status: 429 }
      )

      // إضافة Headers للـ Rate Limit Info
      response.headers.set('X-RateLimit-Limit', limit.toString())
      response.headers.set('X-RateLimit-Remaining', '0')
      response.headers.set('X-RateLimit-Reset', reset.toString())
      response.headers.set('Retry-After', Math.ceil((reset - Date.now()) / 1000).toString())
      response.headers.set('X-RateLimit-Status', 'blocked')
      response.headers.set('X-RateLimit-Identifier', identifier)

      return response
    }

    // إرجاع Response مع headers Rate Limit حتى لو لم يتم حظر الطلب
    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', reset.toString())
    response.headers.set('X-RateLimit-Identifier', identifier)

    return response
  } catch (error) {
    console.error('Rate limit middleware error:', error)
    
    const response = NextResponse.json(
      {
        error: RATE_LIMIT_ERROR_MESSAGE,
        retryAfter: 900, // 15 دقيقة
        code: 'RATE_LIMIT_ERROR',
      },
      { status: 429 }
    )
    
    return response
  }
}

// دالة مساعدة للـ API Routes للحصول على معلومات Rate Limit
export async function getRateLimitInfo(
  request: NextRequest,
  limiter?: { limit: (id: string) => Promise<{ success: boolean; limit: number; remaining: number; reset: number }> }
): Promise<{ identifier: string; userId: string | null; limit: number; remaining: number; reset: number }> {
  const identifier = await getRateLimitIdentifier(request)
  const selectedLimiter = limiter || getRateLimiterForPath(request.nextUrl.pathname)
  const userId = await getUserIdFromRequest(request)
  
  const { limit, remaining, reset } = await checkRateLimit(identifier, selectedLimiter)
  
  return { identifier, userId, limit, remaining, reset }
}

// تصدير الثوابت للاستخدام الخارجي
export const RATE_LIMITS = {
  API: { requests: 100, window: '1 minute' },
  AUTH: { requests: 5, window: '15 minutes' },
  SEARCH: { requests: 30, window: '1 minute' },
  BOOKING: { requests: 10, window: '1 minute' },
  ADMIN: { requests: 50, window: '1 minute' },
}
