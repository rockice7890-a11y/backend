import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { parseDeviceInfo, SECURITY_THRESHOLDS } from '@/utils/securityMonitor'
import { withErrorHandler } from '@/utils/errorHandler'

// GET: جلب لوحة تحكم الأمان
export const GET = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'personal' // 'personal' or 'admin'
  const days = parseInt(searchParams.get('days') || '30')

  if (type === 'admin') {
    // التحقق من صلاحية الأدمن
    const hasPermission = authorize(user, 'SECURITY_AUDIT' as any)
    if (!hasPermission) {
      return errorResponse('FORBIDDEN', 'ليس لديك صلاحية الوصول للوحة تحكم المشرف' as any)
    }
  }

  // جلب إحصائيات الأمان للمستخدم
  const [
    activeSessions,
    trustedDevices,
    recentLogins,
    securityEvents,
    twoFactorStatus,
    failedAttempts,
  ] = await Promise.all([
    // الجلسات النشطة
    prisma.sessionLog.count({
      where: {
        userId: user.userId,
        logoutAt: null,
        expiresAt: { gt: new Date() },
      },
    }),

    // الأجهزة الموثوقة
    prisma.userDevice.count({
      where: { userId: user.userId, isActive: true },
    }),

    // تسجيلات الدخول الأخيرة
    prisma.sessionLog.findMany({
      where: {
        userId: user.userId,
        loginAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
      orderBy: { loginAt: 'desc' },
      take: 10,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        loginAt: true,
        deviceFingerprint: true,
      },
    }),

    // أحداث الأمان
    prisma.auditLog.findMany({
      where: {
        userId: user.userId,
        action: {
          in: [
            'LOGIN_SUCCESS',
            'LOGIN_FAILED',
            '2FA_ENABLED',
            '2FA_DISABLED',
            '2FA_LOGIN_SUCCESS',
            '2FA_LOGIN_FAILED',
            'PASSWORD_CHANGED',
            'ACCOUNT_LOCKED',
            'SESSION_TERMINATED',
          ],
        },
        createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    // حالة 2FA
    prisma.user.findUnique({
      where: { id: user.userId },
      select: { twoFactorEnabled: true },
    }),

    // المحاولات الفاشلة الأخيرة
    prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        failedLoginAttempts: true,
        lockoutUntil: true,
        lastFailedLogin: true,
        lastLoginAt: true,
      },
    }),
  ])

  // تحليل معلومات الجهاز لتسجيلات الدخول
  const loginHistory = recentLogins.map((login) => {
    const deviceInfo = login.userAgent ? parseDeviceInfo(login.userAgent) : null
    return {
      id: login.id,
      ip: login.ipAddress,
      device: deviceInfo
        ? `${deviceInfo.deviceType} - ${deviceInfo.browser} (${deviceInfo.os})`
        : 'Unknown',
      loginAt: login.loginAt,
      isSuspicious: false,
    }
  })

  // حساب مستوى الأمان
  let securityScore = 100
  const securityIssues: string[] = []

  if (!twoFactorStatus?.twoFactorEnabled) {
    securityScore -= 30
    securityIssues.push('المصادقة الثنائية غير مفعلة')
  }

  if (failedAttempts?.lockoutUntil && failedAttempts.lockoutUntil > new Date()) {
    securityScore -= 20
    securityIssues.push('الحساب محظور مؤقتاً')
  }

  if (activeSessions > 3) {
    securityScore -= 10
    securityIssues.push('عدد كبير من الجلسات النشطة')
  }

  if (trustedDevices === 0) {
    securityScore -= 10
    securityIssues.push('لا توجد أجهزة موثقة')
  }

  // تحديد مستوى الأمان
  let securityLevel: 'weak' | 'moderate' | 'good' | 'strong'
  if (securityScore >= 80) {
    securityLevel = 'strong'
  } else if (securityScore >= 60) {
    securityLevel = 'good'
  } else if (securityScore >= 40) {
    securityLevel = 'moderate'
  } else {
    securityLevel = 'weak'
  }

  return successResponse({
    security: {
      score: securityScore,
      level: securityLevel,
      issues: securityIssues,
    },
    status: {
      twoFactorEnabled: twoFactorStatus?.twoFactorEnabled || false,
      activeSessions,
      trustedDevices,
      failedLoginAttempts: failedAttempts?.failedLoginAttempts || 0,
      isLocked: failedAttempts?.lockoutUntil ? failedAttempts.lockoutUntil > new Date() : false,
      lastLogin: failedAttempts?.lastLoginAt,
      lastFailedLogin: failedAttempts?.lastFailedLogin,
    },
    loginHistory,
    recentSecurityEvents: securityEvents.map((event) => ({
      action: event.action,
      details: event.details,
      createdAt: event.createdAt,
    })),
    recommendations: generateSecurityRecommendations(securityLevel, twoFactorStatus?.twoFactorEnabled || false),
  })
}, { method: 'GET', path: '/api/security/dashboard' })

// دالة إنشاء توصيات الأمان
function generateSecurityRecommendations(
  level: string,
  has2FA: boolean
): string[] {
  const recommendations: string[] = []

  if (!has2FA) {
    recommendations.push('نوصي بتفعيل المصادقة الثنائية لإضافة طبقة حماية إضافية لحسابك')
  }

  if (level === 'weak' || level === 'moderate') {
    recommendations.push('راجع جلساتك النشطة وأنهِ الجلسات غير المعروفة')
    recommendations.push('حدث كلمة مرورك بشكل دوري')
  }

  recommendations.push('لا تشارك بيانات تسجيل الدخول مع أي شخص')
  recommendations.push('تحقق من عنوان URL قبل إدخال بياناتك')

  return recommendations
}
