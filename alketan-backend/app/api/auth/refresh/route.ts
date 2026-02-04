import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyRefreshToken,
  generateTokenPair,
  generateSessionId,
  extractDeviceInfo,
  generateDeviceFingerprint,
  decodeRefreshToken
} from '@/utils/auth'
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import {
  createSession,
  createRefreshToken,
  revokeRefreshToken,
  validateRefreshToken,
  deleteSession,
  getSession,
} from '@/lib/sessions'
import { checkRedisConnection } from '@/lib/redis'
import { withErrorHandler } from '@/utils/errorHandler'

export const POST = withErrorHandler(async (request: NextRequest) => {
  // استخراج Refresh Token و CSRF Token
  const refreshToken = request.cookies.get('__Secure-refreshToken')?.value
  const csrfToken = request.headers.get('x-csrf-token')
  const oldSessionId = request.cookies.get('__Secure-sessionId')?.value

  if (!refreshToken) {
    return unauthorizedResponse('Refresh token مطلوب ويجب أن يكون في Cookie')
  }

  // فك تشفير Refresh Token للحصول على jti
  const decodedToken = decodeRefreshToken(refreshToken)
  if (!decodedToken) {
    return unauthorizedResponse('Refresh token غير صالح')
  }

  // التحقق من Redis
  const redisAvailable = await checkRedisConnection()

  // التحقق من Refresh Token في Redis (إن وجد)
  if (redisAvailable) {
    const redisToken = await validateRefreshToken(decodedToken.jti)
    if (!redisToken) {
      return unauthorizedResponse('Refresh token غير صالح أو تم إبطاله')
    }
  }

  // التحقق من Refresh Token في JWT
  const payload = await verifyRefreshToken(refreshToken, csrfToken || undefined)

  if (!payload) {
    return unauthorizedResponse('Refresh token غير صالح أو منتهي الصلاحية')
  }

  // التحقق من أن المستخدم نفسه
  if (payload.userId !== decodedToken.userId) {
    return unauthorizedResponse('توكن غير متطابق')
  }

  // التحقق من المستخدم في قاعدة البيانات
  const user = await prisma.user.findUnique({
    where: { id: payload.userId }
  })

  if (!user || !user.isActive) {
    return unauthorizedResponse('المستخدم غير موجود أو معطل')
  }

  const deviceInfo = extractDeviceInfo(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // إنشاء جلسة جديدة
  const newSessionId = generateSessionId()
  const clientFingerprint = generateDeviceFingerprint(request, userAgent)
  const tokens = generateTokenPair(user.id, user.role, user.adminLevel, clientFingerprint.fingerprint)

  if (redisAvailable) {
    // إبطال Refresh Token القديم
    await revokeRefreshToken(decodedToken.jti, tokens.tokenId)

    // إنشاء Refresh Token جديد
    await createRefreshToken(user.id, newSessionId)

    // إنشاء جلسة جديدة في Redis
    await createSession({
      userId: user.id,
      sessionId: newSessionId,
      role: user.role,
      adminLevel: user.adminLevel,
      email: user.email,
      ipAddress: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      deviceFingerprint: clientFingerprint.fingerprint,
    })

    // حذف الجلسة القديمة من Redis
    if (oldSessionId && oldSessionId !== newSessionId) {
      await deleteSession(oldSessionId, user.id)
    }
  }

  // حفظ الجلسة الجديدة في PostgreSQL (للتدقيق)
  await prisma.sessionLog.create({
    data: {
      userId: user.id,
      token: newSessionId,
      ipAddress: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      deviceFingerprint: clientFingerprint.fingerprint,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 أيام
    }
  })

  // تحديث الجلسة القديمة في PostgreSQL
  if (oldSessionId && oldSessionId !== newSessionId) {
    await prisma.sessionLog.updateMany({
      where: { token: oldSessionId },
      data: { logoutAt: new Date() }
    })
  }

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.id,
    action: 'TOKEN_REFRESHED' as AuditAction,
    resource: 'auth',
    details: {
      newSessionId: newSessionId.substring(0, 8) + '...',
      previousSessionId: oldSessionId ? (oldSessionId.substring(0, 8) + '...') : null,
      newTokenId: tokens.tokenId,
      oldTokenId: decodedToken.jti,
      sessionType: redisAvailable ? 'redis' : 'postgresql',
    },
    ipAddress: deviceInfo.ip,
    userAgent: deviceInfo.userAgent,
  })

  const response = successResponse({
    message: 'تم تجديد التوكن بنجاح',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    tokenId: tokens.tokenId,
  })

  // تحديد إذا كنا في بيئة الإنتاج
  const isProduction = process.env.NODE_ENV === 'production'

  // تحديث Cookies مع __Secure- prefix
  response.cookies.set('__Secure-refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 أيام
    path: '/',
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
  })

  response.cookies.set('__Secure-sessionId', newSessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 أيام
    path: '/',
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
  })

  return response
}, { method: 'POST', path: '/api/auth/refresh' })
