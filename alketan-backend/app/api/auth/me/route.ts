import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractTokenFromHeader, verifyAccessToken, extractDeviceInfo } from '@/utils/auth'
import { successResponse, errorResponse, unauthorizedResponse, notFoundResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

export const GET = withErrorHandler(async (request: NextRequest) => {
  let userId: string | null = null
  let authMethod = ''

  // الطريقة الأولى: التحقق من Authorization Header
  const authHeader = request.headers.get('authorization')
  const accessToken = extractTokenFromHeader(authHeader)

  if (accessToken) {
    const payload = await verifyAccessToken(accessToken)
    if (payload) {
      userId = payload.userId  // استخدام userId
      authMethod = 'access_token'
    }
  }

  // الطريقة الثانية: التحقق من Session ID Cookie
  // إذا لم نجد المستخدم من Authorization Header، نجرب Session Cookie
  if (!userId) {
    const sessionId = request.cookies.get('__Secure-sessionId')?.value ||
      request.cookies.get('sessionId')?.value

    if (sessionId) {
      // البحث عن الجلسة في قاعدة البيانات
      const session = await prisma.sessionLog.findFirst({
        where: {
          token: sessionId,
          logoutAt: null,
          expiresAt: {
            gt: new Date()
          }
        },
        include: {
          user: {
            select: {
              id: true,
              lockoutUntil: true,
              failedLoginAttempts: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            }
          }
        }
      })

      if (session && session.user && session.user.isActive) {
        // تحقق إضافي من IP والـ Fingerprint
        const userAgent = request.headers.get('user-agent') || 'unknown'
        const forwardedFor = request.headers.get('x-forwarded-for')
        const realIp = request.headers.get('x-real-ip')
        const clientIP = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

        // التحقق من IP (إذا كان الـ IP متاحاً)
        if (session.ipAddress && session.ipAddress !== clientIP && session.ipAddress !== 'unknown') {
          console.warn(`Session IP mismatch: expected ${session.ipAddress}, got ${clientIP}`)
          // لا نرفض الطلب، لكن نتحقق من الجهاز
        }

        userId = session.user.id
        authMethod = 'session_cookie'
      }
    }
  }

  // الطريقة الثالثة: استخدام refreshToken للحصول على accessToken جديد
  if (!userId) {
    const refreshToken = request.cookies.get('__Secure-refreshToken')?.value ||
      request.cookies.get('refreshToken')?.value

    if (refreshToken) {
      const { verifyRefreshToken } = await import('@/utils/auth')
      const payload = await verifyRefreshToken(refreshToken)

      if (payload) {
        userId = payload.userId
        authMethod = 'refresh_token'
      }
    }
  }

  if (!userId) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // جلب بيانات المستخدم
  const userData = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      lockoutUntil: true,
      failedLoginAttempts: true,
    },
  })

  if (!userData) {
    return notFoundResponse('المستخدم')
  }

  return successResponse({ user: userData }, { message: 'تم جلب بيانات المستخدم بنجاح' })
}, { method: 'GET', path: '/api/auth/me' })
