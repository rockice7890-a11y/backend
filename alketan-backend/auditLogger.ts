import { prisma } from '@/lib/prisma'
import { extractDeviceInfo, generateDeviceFingerprint } from '@/utils/auth'

// أنواع الأحداث للتدقيق
export type AuditAction =
  // Authentication
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'PASSWORD_CHANGE'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_UNLOCKED'
  | 'FAILED_LOGIN_ATTEMPT'
  | 'FAILED_LOGIN_UNKNOWN_USER'
  | '2FA_LOGIN_FAILED'
  | '2FA_LOGIN_SUCCESS'
  | '2FA_VERIFICATION_FAILED'
  | '2FA_DISABLE_FAILED'
  | 'TERMINATE_SESSION'
  | 'TERMINATE_ALL_OTHER_SESSIONS'
  | 'SECURITY_REPORT_GENERATED'
  | 'DEVICE_ADDED'
  | 'DEVICE_DEACTIVATED'
  | 'DEVICE_DEACTIVATED_AUTO'
  | 'DEVICE_DELETED'
  | 'UNAUTHORIZED_ACCESS'
  | 'PERMISSION_DENIED'
  | 'SUSPICIOUS_ACTIVITY'

  // Users Management
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'USER_ROLE_CHANGED'
  | 'USER_PASSWORD_RESET'
  | 'USER_READ'
  | 'SYSTEM_VIEW'

  // Bookings
  | 'BOOKING_CREATED'
  | 'BOOKING_UPDATED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_CHECKIN'
  | 'BOOKING_CHECKOUT'
  | 'BOOKING_EXTENDED'
  | 'BOOKING_VIEWED'
  | 'BOOKING_MANAGED'

  // Rooms
  | 'ROOM_CREATED'
  | 'ROOM_UPDATED'
  | 'ROOM_DELETED'
  | 'ROOM_READ'
  | 'MAINTENANCE_ADDED'
  | 'ROOM_STATUS_CHANGED'
  | 'MAINTENANCE_ADDED'

  // Payments
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_REFUNDED'
  | 'INVOICE_GENERATED'

  // Hotels
  | 'HOTEL_CREATED'
  | 'HOTEL_UPDATED'
  | 'HOTEL_DELETED'
  | 'HOTEL_STATUS_CHANGED'

  // System
  | 'SETTINGS_CHANGED'
  | 'BACKUP_CREATED'
  | 'SYSTEM_ERROR'
  | 'SECURITY_ALERT'

  // Data Export
  | 'REPORT_GENERATED'
  | 'DATA_EXPORTED'

  // Services
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_DELETED'

  // Reviews
  | 'REVIEW_CREATED'
  | 'REVIEW_UPDATED'
  | 'REVIEW_DELETED'
  | 'FEEDBACK_SUBMITTED'

  // Notifications
  | 'NOTIFICATION_SENT'
  | 'NOTIFICATION_BROADCAST'
  | 'NOTIFICATION_MARK_READ'

  // Loyalty
  | 'LOYALTY_POINTS_AWARDED'
  | 'LOYALTY_POINTS_REDEEMED'
  | 'LOYALTY_TIER_CHANGED'

  // Security
  | 'SUSPICIOUS_ACTIVITY_DETECTED'
  | 'SECURITY_POLICY_UPDATED'

// واجهة سجل التدقيق
export interface AuditLogEntry {
  userId?: string
  action: AuditAction
  resource: string
  resourceId?: string
  details?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  deviceFingerprint?: string
  metadata?: {
    oldValue?: Record<string, any>
    newValue?: Record<string, any>
    reason?: string
    duration?: number
  }
}

// إنشاء سجل تدقيق
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const deviceInfo = extractDeviceInfo({
      headers: new Headers({
        'user-agent': entry.userAgent || ''
      }),
      ip: entry.ipAddress
    } as any)

    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        details: entry.details ? JSON.stringify(entry.details) : undefined,
        ipAddress: entry.ipAddress || deviceInfo.ip,
        userAgent: entry.userAgent || deviceInfo.userAgent,
        deviceFingerprint: entry.deviceFingerprint,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
        createdAt: new Date()
      }
    }).catch(() => {
      //_ فشل في الكتابة لقاعدة البيانات -_ console فقط
      console.warn('Failed to write audit log:', entry.action, entry.resource)
    })
  } catch (error) {
    // لا نريد أن يفشل أي طلب بسبب فشل في التدقيق
    console.error('Audit log error:', error)
  }
}

// الحصول على سجلات التدقيق (للإدارة فقط)
export async function getAuditLogs(options: {
  userId?: string
  action?: AuditAction
  resource?: string
  startDate?: Date
  endDate?: Date
  page?: number
  limit?: number
}) {
  const {
    userId,
    action,
    resource,
    startDate,
    endDate,
    page = 1,
    limit = 50
  } = options

  const where: any = {}

  if (userId) where.userId = userId
  if (action) where.action = action
  if (resource) where.resource = resource

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = startDate
    if (endDate) where.createdAt.lte = endDate
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        action: true,
        resource: true,
        resourceId: true,
        details: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true
      }
    }),
    prisma.auditLog.count({ where })
  ])

  return {
    logs: logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details) : null
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }
}

// البحث في سجلات التدقيق
export async function searchAuditLogs(query: string, limit: number = 100) {
  return prisma.auditLog.findMany({
    where: {
      OR: [
        { resourceId: { contains: query } },
        { ipAddress: { contains: query } },
        { action: { contains: query } },
        { resource: { contains: query } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      userId: true,
      action: true,
      resource: true,
      resourceId: true,
      ipAddress: true,
      createdAt: true
    }
  })
}

// كشف الأنماط المشبوهة
export function detectSuspiciousActivity(logs: Array<{ action: string; ipAddress: string | null; createdAt: Date }>): {
  suspicious: boolean
  alerts: string[]
} {
  const alerts: string[] = []
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // التحقق من كثرة المحاولات الفاشلة
  const failedLogins = logs.filter(l =>
    l.action === 'LOGIN_FAILED' &&
    l.createdAt > oneHourAgo
  ).length

  if (failedLogins > 10) {
    alerts.push(`كثرة محاولات تسجيل الدخول الفاشلة: ${failedLogins} محاولة في الساعة الأخيرة`)
  }

  // التحقق من تغييرات الحسابات
  const accountChanges = logs.filter(l =>
    ['USER_CREATED', 'USER_DELETED', 'USER_ROLE_CHANGED'].includes(l.action) &&
    l.createdAt > oneDayAgo
  ).length

  if (accountChanges > 5) {
    alerts.push(`كثرة تغييرات على حسابات المستخدمين: ${accountChanges} تغيير في 24 ساعة`)
  }

  // التحقق من IP غير معروف
  const unknownIPs = new Set(
    logs.filter(l =>
      l.ipAddress === 'unknown' &&
      l.createdAt > oneHourAgo
    ).map(l => l.ipAddress)
  )

  if (unknownIPs.size > 0) {
    alerts.push(`طلبات من IP غير معروف`)
  }

  return {
    suspicious: alerts.length > 0,
    alerts
  }
}

// تصدير سجلات التدقيق
export async function exportAuditLogs(options: {
  startDate: Date
  endDate: Date
  format: 'csv' | 'json'
}) {
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: options.startDate,
        lte: options.endDate
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  if (options.format === 'json') {
    return JSON.stringify(logs.map(l => ({
      ...l,
      details: l.details ? JSON.parse(l.details) : null
    })), null, 2)
  }

  // CSV format
  const headers = ['التاريخ', 'المستخدم', 'الإجراء', 'المورد', 'المعرّف', 'IP']
  const rows = logs.map(l => [
    l.createdAt.toISOString(),
    l.userId || 'نظام',
    l.action,
    l.resource,
    l.resourceId || '-',
    l.ipAddress || '-'
  ])

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

// تنظيف السجلات القديمة (للـ cron job)
export async function cleanupOldLogs(retentionDays: number = 90) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  const deleted = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  })

  return deleted.count
}
