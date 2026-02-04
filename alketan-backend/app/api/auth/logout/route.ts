import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractTokenFromHeader, verifyAccessToken, extractDeviceInfo, addToBlacklist } from '@/utils/auth'
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import {
  deleteSession,
  deleteAllUserSessions,
  revokeAllUserRefreshTokens,
  getSession,
} from '@/lib/sessions'
import { checkRedisConnection } from '@/lib/redis'
import { withErrorHandler } from '@/utils/errorHandler'

export const POST = withErrorHandler(async (request: NextRequest) => {
  // استخراج Access Token من Header (مطلوب للمصادقة)
  const authHeader = request.headers.get('authorization')
  const accessToken = extractTokenFromHeader(authHeader)

  // استخراج Session ID من Cookie
  const sessionId = request.cookies.get('__Secure-sessionId')?.value
  const oldSessionId = request.cookies.get('sessionId')?.value

  // استخراج معلومات الجهاز
  const deviceInfo = extractDeviceInfo(request)

  // ❌ إذا لا يوجد Access Token ولا SessionId، نرفض الطلب
  if (!accessToken && !sessionId) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }

  // التحقق من Access Token إذا موجود
  let userId: string | null = null

  if (accessToken) {
    const payload = await verifyAccessToken(accessToken)
    if (!payload) {
      return unauthorizedResponse('توكن غير صالح أو منتهي الصلاحية')
    }
    userId = payload.userId
  }

  // إذا لا يوجد accessToken ولكن يوجد sessionId، نحاول استخراج userId من الجلسة
  if (!userId && sessionId) {
    // محاولة الحصول على الجلسة من Redis أولاً
    const redisAvailable = await checkRedisConnection()
    if (redisAvailable) {
      const session = await getSession(sessionId)
      if (session) {
        userId = session.userId
      }
    }

    // إذا لم نجد في Redis، نبحث في PostgreSQL
    if (!userId) {
      const dbSession = await prisma.sessionLog.findFirst({
        where: {
          token: sessionId,
          logoutAt: null
        },
        select: { userId: true }
      })

      if (dbSession) {
        userId = dbSession.userId
      } else {
        return unauthorizedResponse('الجلسة غير صالحة أو منتهية')
      }
    }
  }

  if (!userId) {
    return unauthorizedResponse('غير مصرح')
  }

  // إلغاء الجلسة
  let logoutDetails: any = { sessionsInvalidated: 0, redisSessionsDeleted: 0 }

  // التحقق من توفر Redis
  const redisAvailable = await checkRedisConnection()

  if (redisAvailable) {
    // حذف الجلسة من Redis
    if (sessionId) {
      const deleted = await deleteSession(sessionId, userId)
      if (deleted) logoutDetails.redisSessionsDeleted++
    }
  }

  // إلغاء الجلسة في قاعدة البيانات PostgreSQL
  if (sessionId) {
    const result = await prisma.sessionLog.updateMany({
      where: { token: sessionId },
      data: { logoutAt: new Date() }
    })
    logoutDetails.sessionsInvalidated += result.count
  }

  if (oldSessionId && oldSessionId !== sessionId) {
    const result = await prisma.sessionLog.updateMany({
      where: { token: oldSessionId },
      data: { logoutAt: new Date() }
    })
    logoutDetails.sessionsInvalidated += result.count
  }

  // إضافة Access Token للقائمة السوداء (إبطال فوري)
  if (accessToken) {
    // فك تشفير التوكن للحصول على jti
    const jwt = require('jsonwebtoken')
    const decoded = jwt.decode(accessToken) as { jti: string } | null
    if (decoded && decoded.jti) {
      await addToBlacklist(decoded.jti, 'logout')
    }
  }

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId,
    action: 'LOGOUT' as AuditAction,
    resource: 'auth',
    details: logoutDetails,
    ipAddress: deviceInfo.ip,
    userAgent: deviceInfo.userAgent,
  })

  // إنشاء Response وحذف Cookies
  const response = successResponse({ message: 'تم تسجيل الخروج بنجاح' })

  // تحديد إذا كنا في بيئة الإنتاج
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieDomain = isProduction ? process.env.COOKIE_DOMAIN : undefined

  // حذف Cookies الجديدة مع __Secure- prefix
  response.cookies.set('__Secure-refreshToken', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    domain: cookieDomain,
  })

  response.cookies.set('__Secure-sessionId', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    domain: cookieDomain,
  })

  // حذف Cookies القديمة (للتوافق)
  response.cookies.set('refreshToken', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
    domain: cookieDomain,
  })

  response.cookies.set('sessionId', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
    domain: cookieDomain,
  })

  return response
}, { method: 'POST', path: '/api/auth/logout' })

// تسجيل الخروج من جميع الأجهزة
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authHeader = request.headers.get('authorization')
  const accessToken = extractTokenFromHeader(authHeader)

  if (!accessToken) {
    return unauthorizedResponse('غير مصرح')
  }

  const payload = await verifyAccessToken(accessToken)
  if (!payload) {
    return unauthorizedResponse('توكن غير صالح')
  }

  const deviceInfo = extractDeviceInfo(request)
  const userId = payload.userId

  // إلغاء جميع الجلسات في Redis
  const redisAvailable = await checkRedisConnection()
  let redisSessionsDeleted = 0

  if (redisAvailable) {
    // حذف جميع جلسات المستخدم من Redis
    redisSessionsDeleted = await deleteAllUserSessions(userId)

    // إبطال جميع Refresh Tokens
    await revokeAllUserRefreshTokens(userId)
  }

  // إلغاء جميع الجلسات في PostgreSQL
  const result = await prisma.sessionLog.updateMany({
    where: {
      userId: userId,
      logoutAt: null
    },
    data: { logoutAt: new Date() }
  })

  // إضافة Access Token للقائمة السوداء (إبطال فوري)
  if (accessToken) {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.decode(accessToken) as { jti: string } | null
    if (decoded && decoded.jti) {
      await addToBlacklist(decoded.jti, 'logout_all_devices')
    }
  }

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: userId,
    action: 'LOGOUT_ALL_DEVICES' as AuditAction,
    resource: 'auth',
    details: {
      action: 'logout_all_devices',
      redisSessionsDeleted,
      postgresqlSessionsInvalidated: result.count,
    },
    ipAddress: deviceInfo.ip,
    userAgent: deviceInfo.userAgent,
  })

  const response = successResponse({
    message: 'تم تسجيل الخروج من جميع الأجهزة بنجاح',
    sessionsTerminated: redisSessionsDeleted + result.count
  })

  // حذف جميع Cookies
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieDomain = isProduction ? process.env.COOKIE_DOMAIN : undefined

  response.cookies.set('__Secure-refreshToken', '', { maxAge: 0, path: '/', domain: cookieDomain })
  response.cookies.set('__Secure-sessionId', '', { maxAge: 0, path: '/', domain: cookieDomain })
  response.cookies.set('refreshToken', '', { maxAge: 0, path: '/', domain: cookieDomain })
  response.cookies.set('sessionId', '', { maxAge: 0, path: '/', domain: cookieDomain })

  return response
}, { method: 'DELETE', path: '/api/auth/logout' })
