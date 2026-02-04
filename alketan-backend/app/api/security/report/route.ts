import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { parseDeviceInfo } from '@/utils/securityMonitor'
import { withErrorHandler } from '@/utils/errorHandler'

// أنواع التقارير
export type ReportType =
  | 'security_overview'
  | 'login_activity'
  | 'access_logs'
  | 'security_events'
  | 'session_analysis'
  | 'password_activity'
  | '2fa_status'
  | 'full_audit'

// GET: إنشاء تقرير أمان
export const GET = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const reportType = (searchParams.get('type') || 'security_overview') as ReportType
  const format = searchParams.get('format') || 'json'
  const days = parseInt(searchParams.get('days') || '30')

  // التحقق من الصلاحية للتقارير الإدارية
  if (reportType !== 'security_overview') {
    const hasPermission = authorize(user, 'REPORT_VIEW' as any)
    if (!hasPermission) {
      return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لإنشاء هذا النوع من التقارير')
    }
  }

  // جلب البيانات حسب نوع التقرير
  let reportData: any

  switch (reportType) {
    case 'security_overview':
      reportData = await generateSecurityOverview(user.userId, days)
      break
    case 'login_activity':
      reportData = await generateLoginActivity(user.userId, days)
      break
    case 'access_logs':
      reportData = await generateAccessLogs(user.userId, days)
      break
    case 'security_events':
      reportData = await generateSecurityEvents(user.userId, days)
      break
    case 'session_analysis':
      reportData = await generateSessionAnalysis(user.userId, days)
      break
    case 'password_activity':
      reportData = await generatePasswordActivity(user.userId, days)
      break
    case '2fa_status':
      reportData = await generate2FAStatus(user.userId)
      break
    case 'full_audit':
      reportData = await generateFullAudit(user.userId, days)
      break
    default:
      return errorResponse('BAD_REQUEST', 'نوع التقرير غير صالح')
  }

  // إضافة البيانات الوصفية للتقرير
  const report = {
    metadata: {
      type: reportType,
      generatedAt: new Date().toISOString(),
      generatedBy: user.email,
      period: {
        start: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
        days,
      },
      format,
    },
    data: reportData,
  }

  // تسجيل إنشاء التقرير
  await createAuditLog({
    userId: user.userId,
    action: 'SECURITY_REPORT_GENERATED',
    resource: 'security',
    details: {
      reportType,
      format,
      days,
    },
  })

  // إذا كان التنسيق PDF أو CSV، يتم تصديره
  if (format === 'pdf') {
    return new NextResponse(JSON.stringify(report), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="security-report-${reportType}-${Date.now()}.json`,
      },
    })
  }

  if (format === 'csv') {
    const csv = convertToCSV(reportData)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="security-report-${reportType}-${Date.now()}.csv`,
      },
    })
  }

  return successResponse(report)
}, { method: 'GET', path: '/api/security/report' })

// دوال إنشاء التقارير المختلفة
async function generateSecurityOverview(userId: string, days: number) {
  const [
    totalLogins,
    successfulLogins,
    failedLogins,
    activeSessions,
    trustedDevices,
    securityEvents,
    twoFactorStatus,
  ] = await Promise.all([
    prisma.sessionLog.count({
      where: {
        userId,
        loginAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.auditLog.count({
      where: {
        userId,
        action: 'LOGIN_SUCCESS',
        createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.auditLog.count({
      where: {
        userId,
        action: { in: ['FAILED_LOGIN_ATTEMPT', 'ACCOUNT_LOCKED'] },
        createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.sessionLog.count({
      where: {
        userId,
        logoutAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
    prisma.userDevice.count({ where: { userId, isActive: true } }),
    prisma.auditLog.count({
      where: {
        userId,
        resource: 'security',
        createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    }),
  ])

  // حساب مستوى الأمان
  let securityScore = 100
  const recommendations: string[] = []

  if (!twoFactorStatus?.twoFactorEnabled) {
    securityScore -= 25
    recommendations.push('تفعيل المصادقة الثنائية')
  }

  if (failedLogins > 5) {
    securityScore -= 15
    recommendations.push('مراجعة محاولات تسجيل الدخول الفاشلة')
  }

  if (activeSessions > 3) {
    securityScore -= 10
    recommendations.push('تقليل عدد الجلسات النشطة')
  }

  if (trustedDevices === 0) {
    securityScore -= 10
    recommendations.push('تسجيل أجهزة موثوقة')
  }

  return {
    summary: {
      securityScore: Math.max(0, securityScore),
      totalLogins,
      successfulLogins,
      failedLogins,
      activeSessions,
      trustedDevices,
      securityEvents,
      twoFactorEnabled: twoFactorStatus?.twoFactorEnabled || false,
    },
    recommendations,
  }
}

async function generateLoginActivity(userId: string, days: number) {
  const logins = await prisma.auditLog.findMany({
    where: {
      userId,
      action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'FAILED_LOGIN_ATTEMPT'] },
      createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  const loginByDay: Record<string, { success: number; failed: number }> = {}
  const loginByHour: Record<number, { success: number; failed: number }> = {}

  for (const login of logins) {
    const date = new Date(login.createdAt).toISOString().split('T')[0]
    const hour = new Date(login.createdAt).getHours()

    if (!loginByDay[date]) {
      loginByDay[date] = { success: 0, failed: 0 }
    }

    if (!loginByHour[hour]) {
      loginByHour[hour] = { success: 0, failed: 0 }
    }

    if (login.action === 'LOGIN_SUCCESS') {
      loginByDay[date].success++
      loginByHour[hour].success++
    } else {
      loginByDay[date].failed++
      loginByHour[hour].failed++
    }
  }

  return {
    totalLogins: logins.length,
    byDay: loginByDay,
    byHour: loginByHour,
    recentLogins: logins.slice(0, 20).map((l) => ({
      action: l.action,
      ip: l.ipAddress,
      details: l.details,
      createdAt: l.createdAt,
    })),
  }
}

async function generateAccessLogs(userId: string, days: number) {
  const logs = await prisma.auditLog.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return {
    totalLogs: logs.length,
    actions: logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1
      return acc
    }, {} as Record<string, number>),
    logs: logs.map((l) => ({
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId,
      ip: l.ipAddress,
      details: l.details,
      createdAt: l.createdAt,
    })),
  }
}

async function generateSecurityEvents(userId: string, days: number) {
  const events = await prisma.auditLog.findMany({
    where: {
      userId,
      action: {
        in: [
          '2FA_ENABLED',
          '2FA_DISABLED',
          'PASSWORD_CHANGED',
          'ACCOUNT_LOCKED',
          '2FA_LOGIN_SUCCESS',
          '2FA_LOGIN_FAILED',
          'SUSPICIOUS_ACTIVITY',
          'TERMINATE_SESSION',
        ],
      },
      createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  return {
    totalEvents: events.length,
    byType: events.reduce((acc, event) => {
      acc[event.action] = (acc[event.action] || 0) + 1
      return acc
    }, {} as Record<string, number>),
    events: events.map((e) => ({
      type: e.action,
      details: e.details,
      ip: e.ipAddress,
      createdAt: e.createdAt,
    })),
  }
}

async function generateSessionAnalysis(userId: string, days: number) {
  const sessions = await prisma.sessionLog.findMany({
    where: {
      userId,
      loginAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    },
    orderBy: { loginAt: 'desc' },
  })

  // تحليل الأجهزة
  const devices = new Set<string>()
  const locations = new Set<string>()
  const sessionDurations: number[] = []

  for (const session of sessions) {
    if (session.deviceFingerprint) {
      devices.add(session.deviceFingerprint)
    }
    if (session.ipAddress) {
      locations.add(session.ipAddress)
    }

    if (session.logoutAt) {
      const duration = session.logoutAt.getTime() - session.loginAt.getTime()
      sessionDurations.push(duration)
    }
  }

  return {
    totalSessions: sessions.length,
    uniqueDevices: devices.size,
    uniqueLocations: locations.size,
    averageSessionDuration: sessionDurations.length > 0
      ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length / 1000 / 60)
      : null,
    recentSessions: sessions.slice(0, 10).map((s) => ({
      ip: s.ipAddress,
      device: s.deviceFingerprint || 'Unknown',
      loginAt: s.loginAt,
      logoutAt: s.logoutAt,
      duration: s.logoutAt
        ? Math.round((s.logoutAt.getTime() - s.loginAt.getTime()) / 1000 / 60)
        : null,
    })),
  }
}

async function generatePasswordActivity(userId: string, days: number) {
  const events = await prisma.auditLog.findMany({
    where: {
      userId,
      action: { in: ['PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED'] },
      createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      failedLoginAttempts: true,
      lockoutUntil: true,
      createdAt: true,
    },
  })

  return {
    passwordChanges: events.filter((e) => e.action === 'PASSWORD_CHANGED').length,
    passwordResets: events.filter((e) => e.action.startsWith('PASSWORD_RESET')).length,
    recentActivity: events.map((e) => ({
      type: e.action,
      ip: e.ipAddress,
      createdAt: e.createdAt,
    })),
    currentStatus: {
      failedAttempts: user?.failedLoginAttempts || 0,
      isLocked: user?.lockoutUntil ? user.lockoutUntil > new Date() : false,
      accountAge: user?.createdAt
        ? Math.round((Date.now() - user.createdAt.getTime()) / 1000 / 60 / 60 / 24)
        : null,
    },
  }
}

async function generate2FAStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
      createdAt: true,
    },
  })

  const events = await prisma.auditLog.findMany({
    where: {
      userId,
      action: { in: ['2FA_ENABLED', '2FA_DISABLED', '2FA_LOGIN_SUCCESS', '2FA_LOGIN_FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return {
    isEnabled: user?.twoFactorEnabled || false,
    backupCodesRemaining: user?.twoFactorBackupCodes
      ? JSON.parse(user.twoFactorBackupCodes).length
      : 0,
    enabledAt: events.find((e) => e.action === '2FA_ENABLED')?.createdAt,
    recentActivity: events.map((e) => ({
      action: e.action,
      success: !e.action.includes('FAILED'),
      ip: e.ipAddress,
      createdAt: e.createdAt,
    })),
    recommendations: user?.twoFactorEnabled
      ? []
      : ['تفعيل المصادقة الثنائية يضيف طبقة حماية إضافية لحسابك'],
  }
}

async function generateFullAudit(userId: string, days: number) {
  const [
    overview,
    loginActivity,
    securityEvents,
    sessionAnalysis,
    passwordActivity,
    twoFAStatus,
  ] = await Promise.all([
    generateSecurityOverview(userId, days),
    generateLoginActivity(userId, days),
    generateSecurityEvents(userId, days),
    generateSessionAnalysis(userId, days),
    generatePasswordActivity(userId, days),
    generate2FAStatus(userId),
  ])

  return {
    overview,
    loginActivity,
    securityEvents,
    sessionAnalysis,
    passwordActivity,
    twoFAStatus,
  }
}

// تحويل البيانات إلى CSV
function convertToCSV(data: any): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return ''

    const headers = Object.keys(data[0])
    const rows = data.map((item) =>
      headers.map((header) => {
        const value = item[header]
        if (typeof value === 'object') return JSON.stringify(value)
        return String(value || '')
      }).join(',')
    )

    return [headers.join(','), ...rows].join('\n')
  }

  if (typeof data === 'object') {
    const lines: string[] = []
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        lines.push(`${key},"${JSON.stringify(value)}"`)
      } else if (typeof value === 'object') {
        lines.push(`${key},"${JSON.stringify(value)}"`)
      } else {
        lines.push(`${key},${value}`)
      }
    }
    return lines.join('\n')
  }

  return String(data)
}
