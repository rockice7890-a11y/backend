import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.USER_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لعرض الإشعارات', { status: 403 })
  }

  const notification = await prisma.notification.findUnique({
    where: { id },
  })

  if (!notification) {
    return errorResponse('NOT_FOUND', 'الإشعار غير موجود', { status: 404 })
  }

  // التحقق من أن المستخدم يملك الإشعار
  if (notification.userId !== user.userId && user.role !== 'ADMIN' && user.role !== 'HOTEL_MANAGER') {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لتحديث هذا الإشعار', { status: 403 })
  }

  const updatedNotification = await prisma.notification.update({
    where: { id },
    data: {
      isRead: true,
      readAt: new Date(),
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

  return successResponse({ notification: updatedNotification })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/notifications/[id]/read' })
