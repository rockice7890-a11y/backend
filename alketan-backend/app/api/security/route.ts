import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, validationProblem } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // التحقق من الصلاحيات
  const hasPermission = authorize(user, PermissionType.SYSTEM_CONFIGURATION) ||
    ['SUPER_ADMIN', 'ADMIN'].includes(user.role) ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لعرض بيانات المراقبة')
  }

  const { searchParams } = new URL(request.url)
  const hours = parseInt(searchParams.get('hours') || '24')

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000)

  // جلب الإحصائيات الأمنية
  const [
    failedLogins,
    successfulLogins,
    suspiciousIPs,
    rateLimitHits,
    permissionDenials,
    activeSessions,
    recentAuditLogs
  ] = await Promise.all([
    // محاولات تسجيل الدخول الفاشلة
    prisma.auditLog.count({
      where: {
        action: 'LOGIN_FAILED',
        createdAt: { gte: startTime }
      }
    }),

    // تسجيلات الدخول الناجحة
    prisma.auditLog.count({
      where: {
        action: 'LOGIN_SUCCESS',
        createdAt: { gte: startTime }
      }
    }),

    // IPs مشبوهة (كثرة المحاولات الفاشلة)
    prisma.auditLog.groupBy({
      by: ['ipAddress'],
      where: {
        action: 'LOGIN_FAILED',
        createdAt: { gte: startTime },
        ipAddress: { not: 'unknown' }
      },
      _count: true,
      having: {
        ipAddress: {
          _count: {
            gte: 5
          }
        }
      }
    }),

    // محاولات تجاوز Rate Limit
    prisma.auditLog.count({
      where: {
        action: 'FEEDBACK_SUBMITTED' as AuditAction,
        createdAt: { gte: startTime }
      }
    }),

    // رفض الصلاحيات
    prisma.auditLog.count({
      where: {
        action: 'PERMISSION_DENIED',
        createdAt: { gte: startTime }
      }
    }),

    // الجلسات النشطة
    prisma.sessionLog.count({
      where: {
        logoutAt: null,
        expiresAt: { gt: new Date() }
      }
    }),

    // أحدث الأحداث الأمنية
    prisma.auditLog.findMany({
      where: {
        createdAt: { gte: startTime },
        action: {
          in: ['LOGIN_FAILED', 'SECURITY_ALERT', 'PERMISSION_DENIED', 'ACCOUNT_LOCKED']
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        ipAddress: true,
        userId: true,
        details: true,
        createdAt: true
      }
    })
  ])

  // تحليل مستوى المخاطر
  const riskLevel = calculateRiskLevel({
    failedLogins,
    suspiciousIPs: suspiciousIPs.length,
    rateLimitHits,
    permissionDenials
  })

  const monitoring = {
    period: {
      hours,
      startTime: startTime.toISOString(),
      endTime: new Date().toISOString()
    },
    metrics: {
      failedLogins,
      successfulLogins,
      successRate: successfulLogins + failedLogins > 0
        ? Math.round((successfulLogins / (successfulLogins + failedLogins)) * 100)
        : 100,
      suspiciousIPs: suspiciousIPs.length,
      rateLimitHits,
      permissionDenials,
      activeSessions
    },
    riskAssessment: {
      level: riskLevel.level,
      score: riskLevel.score,
      factors: riskLevel.factors,
      recommendation: riskLevel.recommendation
    },
    suspiciousIPs: suspiciousIPs.map(ip => ({
      ip: ip.ipAddress,
      failedAttempts: ip._count
    })),
    recentEvents: recentAuditLogs.map(log => ({
      id: log.id,
      action: log.action,
      ip: log.ipAddress,
      userId: log.userId,
      details: log.details ? JSON.parse(log.details) : null,
      timestamp: log.createdAt
    })),
    systemHealth: {
      database: 'connected',
      timestamp: new Date().toISOString()
    }
  }

  // تسجيل الوصول للمراقبة الأمنية
  await createAuditLog({
    userId: user.userId,
    action: 'SECURITY_ALERT' as AuditAction,
    resource: 'security_monitoring',
    details: {
      action: 'view_monitoring',
      period: `${hours} hours`
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse(monitoring, { message: 'تم جلب بيانات المراقبة الأمنية' })
}

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // التحقق من الصلاحيات
  const hasPermission = authorize(user, PermissionType.SYSTEM_CONFIGURATION) ||
    ['SUPER_ADMIN', 'ADMIN'].includes(user.role) ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لتنفيذ هذا الإجراء')
  }

  const body = await request.json()
  const { action, reason } = body

  if (!action || !['lockdown', 'unlock'].includes(action)) {
    return validationProblem([{ field: 'action', message: 'إجراء غير صالح' }])
  }

  if (action === 'lockdown') {
    // قفل النظام
    await prisma.systemSetting.upsert({
      where: { id: 'system' },
      create: {
        id: 'system',
        key: 'system_lockdown',
        name: 'System Lockdown',
        category: 'SECURITY',
        type: 'BOOLEAN',
        value: JSON.stringify({
          lockdownMode: true,
          lockdownReason: reason,
          lockdownBy: user.userId,
          lockdownAt: new Date().toISOString()
        })
      },
      update: {
        value: JSON.stringify({
          lockdownMode: true,
          lockdownReason: reason,
          lockdownBy: user.userId,
          lockdownAt: new Date().toISOString()
        })
      }
    })

    await createAuditLog({
      userId: user.userId,
      action: 'SECURITY_ALERT' as AuditAction,
      resource: 'system',
      details: {
        action: 'lockdown',
        reason
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    })

    return successResponse({
      lockdown: true,
      reason,
      timestamp: new Date().toISOString()
    }, { message: 'تم قفل النظام بنجاح' })

  } else if (action === 'unlock') {
    // فتح النظام
    await prisma.systemSetting.updateMany({
      where: { id: 'system' },
      data: {
        value: JSON.stringify({
          lockdownMode: false,
          lockdownReason: null,
          lockdownBy: null,
          lockdownAt: null
        })
      }
    })

    await createAuditLog({
      userId: user.userId,
      action: 'SECURITY_ALERT' as AuditAction,
      resource: 'system',
      details: {
        action: 'unlock'
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    })

    return successResponse({
      lockdown: false,
      timestamp: new Date().toISOString()
    }, { message: 'تم فتح النظام بنجاح' })
  }

  return validationProblem([{ field: 'action', message: 'إجراء غير صالح' }])
}

// حساب مستوى المخاطر
function calculateRiskLevel(data: {
  failedLogins: number
  suspiciousIPs: number
  rateLimitHits: number
  permissionDenials: number
}): { level: 'low' | 'medium' | 'high' | 'critical'; score: number; factors: string[]; recommendation: string } {
  let score = 0
  const factors: string[] = []

  // تحليل العوامل
  if (data.failedLogins > 50) {
    score += 30
    factors.push('كثرة محاولات تسجيل الدخول الفاشلة')
  } else if (data.failedLogins > 20) {
    score += 15
    factors.push('عدد متوسط من محاولات تسجيل الدخول الفاشلة')
  }

  if (data.suspiciousIPs > 0) {
    score += 25
    factors.push(`${data.suspiciousIPs} عنوان IP مشبوه`)
  }

  if (data.rateLimitHits > 100) {
    score += 20
    factors.push('كثرة محاولات تجاوز حدود الطلبات')
  }

  if (data.permissionDenials > 10) {
    score += 15
    factors.push('محاولات وصول غير مصرح بها')
  }

  // تحديد المستوى
  let level: 'low' | 'medium' | 'high' | 'critical'
  let recommendation: string

  if (score >= 70) {
    level = 'critical'
    recommendation = 'تحذير! تم اكتشاف نشاط مشبوه كثيف. يُنصح بمراجعة السجلات فوراً وقد يتطلب الأمر قفل النظام مؤقتاً.'
  } else if (score >= 40) {
    level = 'high'
    recommendation = 'مستوى أمان مرتفع. يُنصح بمراجعة IPs المشبوهة وزيادة المراقبة.'
  } else if (score >= 20) {
    level = 'medium'
    recommendation = 'مستوى أمان متوسط. استمر في المراقبة.'
  } else {
    level = 'low'
    recommendation = 'نظام آمن. لا توجد مخاطر واضحة.'
  }

  return { level, score, factors, recommendation }
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/security' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/security' })
