import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const body = await request.json();
  const { notificationId, markAll } = body;

  if (markAll) {
    // تحديد جميع الإشعارات كمقروءة
    await prisma.notification.updateMany({
      where: { userId: user.userId },
      data: { isRead: true, readAt: new Date() },
    });

    return successResponse({
      success: true,
      message: 'تم تحديد جميع الإشعارات كمقروءة',
    })
  }

  if (notificationId) {
    // تحديد إشعار واحد كمقروء
    await prisma.notification.update({
      where: { id: notificationId, userId: user.userId },
      data: { isRead: true, readAt: new Date() },
    });

    return successResponse({
      success: true,
      message: 'تم تحديد الإشعار كمقروء',
    })
  }

  return errorResponse('BAD_REQUEST', 'notificationId أو markAll مطلوب', { status: 400 })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/notifications/mark-read' })
