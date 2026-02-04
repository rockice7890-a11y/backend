import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, paginatedResponse, createdResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

const notificationSchema = z.object({
  userId: z.string().optional(),
  title: z.string().min(1, 'العنوان مطلوب'),
  message: z.string().min(1, 'الرسالة مطلوبة'),
  type: z.enum(['booking', 'payment', 'system', 'promotion']).optional(),
  link: z.string().optional(),
})

// الحصول على الإشعارات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const isRead = searchParams.get('isRead')
  const type = searchParams.get('type')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')

  const where: any = {}

  // المستخدم العادي يرى إشعاراته فقط
  if (user.role === 'USER' || user.role === 'GUEST') {
    where.userId = user.userId
  } else if (!['ADMIN', 'HOTEL_MANAGER', 'SUPER_ADMIN'].includes(user.role)) {
    where.userId = user.userId
  }

  if (isRead !== null) where.isRead = isRead === 'true'
  if (type) where.type = type

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where })
  ])

  // عدد الإشعارات غير المقروءة
  const unreadCount = await prisma.notification.count({
    where: {
      ...where,
      isRead: false,
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'NOTIFICATION_MARK_READ' as AuditAction,
    resource: 'notifications',
    details: { action: 'list', filters: { isRead, type } },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return paginatedResponse(notifications, total, page, limit, {
    message: 'تم جلب الإشعارات بنجاح',
    unreadCount
  })
}

// إنشاء إشعار جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.USER_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإرسال الإشعارات')
  }

  const body = await request.json()
  const validatedData = notificationSchema.parse(body)

  // إذا لم يتم تحديد userId، يتم إرسال الإشعار للمستخدم الحالي
  const userId = validatedData.userId || user.userId

  const notification = await prisma.notification.create({
    data: {
      userId,
      title: validatedData.title,
      message: validatedData.message,
      type: validatedData.type || 'system',
      link: validatedData.link,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'NOTIFICATION_SENT' as AuditAction,
    resource: 'notification',
    resourceId: notification.id,
    details: { title: notification.title, type: notification.type, targetUserId: userId },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({ notification }, {
    message: 'تم إنشاء الإشعار بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/notifications' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/notifications' })
