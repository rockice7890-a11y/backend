import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from '@/utils/auth'
import { hasPermission, PermissionType, PermissionScope, Permissions } from '@/utils/permissions'
import { UserRole, AdminLevel } from '@prisma/client'
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, RESPONSE_CODES } from '@/utils/apiResponse'
import { prisma } from '@/lib/prisma'
import { rateLimitMiddleware, apiRateLimit, authRateLimit, getRateLimitIdentifier } from '@/utils/rateLimit'
import { getSession } from '@/lib/sessions'
import { checkRedisConnection } from '@/lib/redis'

export interface AuthRequest extends NextRequest {
  user?: {
    userId: string
    role: UserRole
    adminLevel?: AdminLevel | null
    email?: string
  }
}

// Middleware للمصادقة - نسخة محسنة مع دعم Redis Sessions
export async function authenticate(request: NextRequest): Promise<{ userId: string; role: UserRole; adminLevel?: AdminLevel | null; email?: string } | null> {
  try {
    const authHeader = request.headers.get('authorization')
    const token = extractTokenFromHeader(authHeader)

    // استخراج Session ID من Cookie
    const sessionId = request.cookies.get('__Secure-sessionId')?.value

    // محاولة التحقق من Access Token أولاً
    if (token) {
      const decoded = await verifyAccessToken(token)
      if (decoded) {
        // تحديث آخر نشاط للجلسة في Redis إن وجد
        if (sessionId) {
          const redisAvailable = await checkRedisConnection()
          if (redisAvailable) {
            const { touchSession } = await import('@/lib/sessions')
            await touchSession(sessionId).catch(() => { })
          }
        }

        return {
          userId: decoded.userId,
          role: decoded.role as UserRole,
          adminLevel: decoded.adminLevel as AdminLevel | null,
          // email لا يُرسل في الـ token لأسباب أمنية
          // يمكن الحصول عليه من الجلسة أو قاعدة البيانات عند الحاجة
          email: undefined,
        }
      }
    }

    // إذا لم يوجد accessToken صالح، نستخدم Session ID
    if (sessionId) {
      // محاولة الحصول على الجلسة من Redis أولاً
      const redisAvailable = await checkRedisConnection()
      if (redisAvailable) {
        const session = await getSession(sessionId)
        if (session) {
          // تحديث آخر نشاط الجلسة
          const { touchSession } = await import('@/lib/sessions')
          await touchSession(sessionId).catch(() => { })

          return {
            userId: session.userId,
            role: session.role as UserRole,
            adminLevel: session.adminLevel as AdminLevel | null,
            email: session.email,
          }
        }
      }

      // إذا لم نجد في Redis، نبحث في PostgreSQL
      const dbSession = await prisma.sessionLog.findFirst({
        where: {
          token: sessionId,
          logoutAt: null,
          expiresAt: { gt: new Date() }
        },
        select: {
          userId: true,
          user: {
            select: {
              role: true,
              adminLevel: true,
              email: true,
            }
          }
        }
      })

      if (dbSession) {
        return {
          userId: dbSession.userId,
          role: dbSession.user.role as UserRole,
          adminLevel: dbSession.user.adminLevel as AdminLevel | null,
          email: dbSession.user.email,
        }
      }
    }

    return null
  } catch (error) {
    console.error('Authenticate error:', error)
    return null
  }
}

// Middleware للتحقق من الصلاحيات بناءً على نوع العملية
export function authorize(
  user: { role: UserRole; adminLevel?: AdminLevel | null },
  permission: PermissionType,
  scope: PermissionScope = PermissionScope.GLOBAL
): boolean {
  return hasPermission(user.role, user.adminLevel, permission, scope)
}

// Middleware متقدم للتحقق من المصادقة والصلاحيات مع رسائل مفصلة
export async function requireAuth(
  request: NextRequest,
  requiredPermission?: PermissionType,
  options?: {
    requireSuperAdmin?: boolean
    allowGuest?: boolean
  }
): Promise<NextResponse | null> {
  const user = await authenticate(request)

  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }

  // التحقق من صلاحية SUPER_ADMIN
  if (options?.requireSuperAdmin && user.adminLevel !== 'SUPER_ADMIN') {
    return forbiddenResponse('هذه الصلاحية للمشرفين الأعلى فقط')
  }

  // التحقق من الصلاحية المحددة
  if (requiredPermission && !authorize(user, requiredPermission)) {
    return forbiddenResponse(`ليس لديك صلاحية: ${requiredPermission}`)
  }

  // إرفاق بيانات المستخدم بالـ Request
  ; (request as AuthRequest).user = user

  return null
}

// Helper function لإنشاء response للخطأ - نسخة محسنة
export function createErrorResponse(
  message: string,
  status: number = 400,
  code: string = RESPONSE_CODES.BAD_REQUEST
): NextResponse {
  return errorResponse(code as any, message, { status })
}

// Helper function لإنشاء response للنجاح
export function createSuccessResponse(data: any, status: number = 200, message?: string): NextResponse {
  return successResponse(data, { message: message || 'تم تنفيذ العملية بنجاح' })
}

// Middleware للتحقق من الجلسة النشطة
export async function requireActiveSession(request: NextRequest): Promise<NextResponse | null> {
  const sessionId = request.cookies.get('__Secure-sessionId')?.value

  if (!sessionId) {
    return unauthorizedResponse('جلسة غير صالحة')
  }

  // محاولة Redis أولاً
  const redisAvailable = await checkRedisConnection()
  if (redisAvailable) {
    const session = await getSession(sessionId)
    if (!session) {
      return unauthorizedResponse('الجلسة منتهية أو ملغاة')
    }

    // التحقق من IP
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown'
    if (session.ipAddress && session.ipAddress !== clientIP && session.ipAddress !== 'unknown') {
      console.warn(`IP mismatch for user ${session.userId}: ${session.ipAddress} vs ${clientIP}`)
    }

    return null
  }

  // PostgreSQL fallback
  const session = await prisma.sessionLog.findFirst({
    where: {
      token: sessionId,
      logoutAt: null,
      expiresAt: { gt: new Date() }
    }
  })

  if (!session) {
    return unauthorizedResponse('الجلسة منتهية أو ملغاة')
  }

  // التحقق من IP
  const clientIP = request.headers.get('x-forwarded-for') || 'unknown'
  if (session.ipAddress && session.ipAddress !== clientIP && session.ipAddress !== 'unknown') {
    console.warn(`IP mismatch for user ${session.userId}: ${session.ipAddress} vs ${clientIP}`)
  }

  return null
}

// دالة مساعدة لتسجيل الأحداث الأمنية
export async function logSecurityEvent(
  request: NextRequest,
  event: {
    type: 'LOGIN_FAILED' | 'SECURITY_ALERT' | 'ACCOUNT_LOCKED' | 'FAILED_LOGIN_ATTEMPT'
    userId?: string
    resource?: string
    details?: Record<string, any>
  }
): Promise<void> {
  try {
    const { createAuditLog } = await import('@/utils/auditLogger')
    await createAuditLog({
      userId: event.userId,
      action: event.type as any,
      resource: event.resource || 'security',
      details: event.details,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    })
  } catch (error) {
    console.error('Failed to log security event:', error)
  }
}

// دالة للتحقق من Rate Limit وإرجاع Response إذا تم تجاوزه
export async function requireRateLimit(
  request: NextRequest,
  options?: { strict?: boolean }
): Promise<{ success: boolean; limit: number; remaining: number; reset: number } | NextResponse<any> | null> {
  try {
    const { checkRateLimit, getRateLimitIdentifier, apiRateLimit } = await import('@/utils/rateLimit')

    const identifier = await getRateLimitIdentifier(request)
    const result = await checkRateLimit(identifier, apiRateLimit)

    if (!result.success) {
      const resetSeconds = Math.ceil((result.reset - Date.now()) / 1000)

      return NextResponse.json({
        success: false,
        error: 'تم تجاوز حد الطلبات، يرجى المحاولة لاحقاً',
        retryAfter: resetSeconds,
        rateLimit: {
          limit: result.limit,
          remaining: 0,
          reset: result.reset,
        }
      }, {
        status: 429,
        headers: {
          'Retry-After': String(resetSeconds),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.reset),
        }
      })
    }

    return result
  } catch (error) {
    console.error('Rate limit check error:', error)

    // في حالة الخطأ، نسمح بالطلب (Fail Open) إلا في الوضع Strict
    if (options?.strict) {
      return NextResponse.json({
        success: false,
        error: 'خطأ في التحقق من معدل الطلبات'
      }, { status: 500 })
    }

    return null
  }
}

// تصدير الثوابت للصلاحيات
export const PERMISSIONS = Permissions
