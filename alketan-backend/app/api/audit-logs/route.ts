import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { getAuditLogs, exportAuditLogs, detectSuspiciousActivity, cleanupOldLogs } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // التحقق من الصلاحيات - فقط المشرفون يمكنهم رؤية السجلات
  const hasPermission = authorize(user, PermissionType.AUDIT_VIEW) ||
    ['SUPER_ADMIN', 'ADMIN'].includes(user.role) ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لعرض سجلات التدقيق')
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const action = searchParams.get('action') || undefined
  const resource = searchParams.get('resource') || undefined
  const userId = searchParams.get('userId') || undefined
  const startDateParam = searchParams.get('startDate')
  const endDateParam = searchParams.get('endDate')
  const exportFormat = searchParams.get('export') || undefined

  const startDate = startDateParam ? new Date(startDateParam) : undefined
  const endDate = endDateParam ? new Date(endDateParam) : undefined

  // إذا كان طلب تصدير
  if (exportFormat) {
    if (!startDate || !endDate) {
      return errorResponse('BAD_REQUEST', 'يجب تحديد تاريخ البداية والنهاية للتصدير')
    }

    const exportedData = await exportAuditLogs({
      startDate,
      endDate,
      format: exportFormat as 'csv' | 'json'
    })

    // تسجيل عملية التصدير
    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: 'DATA_EXPORTED',
        resource: 'audit_logs',
        details: JSON.stringify({
          format: exportFormat,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        }),
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined
      }
    })

    const contentType = exportFormat === 'csv' ? 'text/csv' : 'application/json'
    const filename = `audit_logs_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`

    return new NextResponse(exportedData, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}.${exportFormat}"`
      }
    })
  }

  // جلب السجلات مع Pagination
  const result = await getAuditLogs({
    action: action as any,
    resource,
    userId,
    startDate,
    endDate,
    page,
    limit
  })

  // كشف النشاط المشبوه
  const recentLogs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      action: true,
      ipAddress: true,
      createdAt: true
    }
  })

  const securityCheck = detectSuspiciousActivity(recentLogs)

  return paginatedResponse(result.logs, result.pagination.total, page, limit, {
    message: 'تم جلب سجلات التدقيق بنجاح',
    securityCheck: securityCheck.suspicious ? {
      alert: true,
      alerts: securityCheck.alerts
    } : {
      alert: false
    }
  })
}

const handleDelete = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // فقط SUPER_ADMIN يمكنه حذف السجلات
  if (user.adminLevel !== 'SUPER_ADMIN') {
    return forbiddenResponse('ليس لديك صلاحية لحذف السجلات')
  }

  const { searchParams } = new URL(request.url)
  const retentionDays = parseInt(searchParams.get('retentionDays') || '90')

  const deletedCount = await cleanupOldLogs(retentionDays)

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'SYSTEM_ERROR',
      resource: 'audit_logs',
      details: JSON.stringify({
        action: 'cleanup',
        retentionDays,
        deletedCount
      }),
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    }
  })

  return successResponse({
    deletedCount,
    retentionDays
  }, { message: `تم حذف ${deletedCount} سجل قديم` })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/audit-logs' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/audit-logs' })
