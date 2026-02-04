import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import {
  getUserActiveSessions,
  terminateSession,
  terminateOtherSessions,
  parseDeviceInfo,
} from '@/utils/securityMonitor'
import { withErrorHandler } from '@/utils/errorHandler'

// GET: جلب جميع الجلسات النشطة
export const GET = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const currentSessionId = searchParams.get('currentSessionId')

  // جلب الجلسات النشطة
  const sessions = await getUserActiveSessions(user.userId)

  // تحليل معلومات الجهاز لكل جلسة
  const sessionsWithInfo = sessions.map((session) => {
    const deviceInfo = session.userAgent
      ? parseDeviceInfo(session.userAgent)
      : { deviceType: 'Unknown', browser: 'Unknown', os: 'Unknown' }

    const isCurrent = currentSessionId && session.id === currentSessionId

    return {
      id: session.id,
      deviceType: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      ip: session.ipAddress,
      loginAt: session.loginAt,
      expiresAt: session.expiresAt,
      isCurrent,
    }
  })

  return successResponse({
    sessions: sessionsWithInfo,
    totalSessions: sessions.length,
  })
}, { method: 'GET', path: '/api/auth/sessions' })

// DELETE: إنهاء جلسة أو جميع الجلسات
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  const terminateAll = searchParams.get('terminateAll') === 'true'
  const currentSessionId = searchParams.get('currentSessionId')

  if (terminateAll && currentSessionId) {
    // إنهاء جميع الجلسات الأخرى
    const terminatedCount = await terminateOtherSessions(currentSessionId, user.userId)

    await createAuditLog({
      userId: user.userId,
      action: 'TERMINATE_ALL_OTHER_SESSIONS',
      resource: 'auth',
      details: {
        terminatedSessions: terminatedCount,
      },
    })

    return successResponse({
      message: `تم إنهاء ${terminatedCount} جلسة أخرى`,
      terminatedCount,
    })
  }

  if (sessionId) {
    // إنهاء جلسة معينة
    const terminated = await terminateSession(sessionId, user.userId)

    if (!terminated) {
      return notFoundResponse('الجلسة')
    }

    await createAuditLog({
      userId: user.userId,
      action: 'TERMINATE_SESSION',
      resource: 'auth',
      details: {
        sessionId,
      },
    })

    return successResponse({
      message: 'تم إنهاء الجلسة بنجاح',
    })
  }

  return validationProblem([{ field: 'sessionId', message: 'يرجى تحديد الجلسة المراد إنهائها' }])
}, { method: 'DELETE', path: '/api/auth/sessions' })
