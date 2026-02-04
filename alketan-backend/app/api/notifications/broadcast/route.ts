import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse, unauthorizedResponse, forbiddenResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  // فقط المديرين يمكنهم الإرسال الجماعي
  if (!['ADMIN'].includes(user.role) &&
    !['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')) {
    return forbiddenResponse('غير مصرح')
  }

  const body = await request.json();
  const { title, message, type, targetRole, hotelId, link } = body;

  if (!title || !message) {
    return errorResponse('BAD_REQUEST', 'title و message مطلوبان', { status: 400 })
  }

  // تحديد المستهدفين
  const where: any = { isActive: true };
  if (targetRole) where.role = targetRole;

  const users = await prisma.user.findMany({
    where,
    select: { id: true },
  });

  // إنشاء الإشعارات
  const notificationsData = users.map(recipient => ({
    userId: recipient.id,
    title,
    message,
    type: type || 'system',
    link,
    createdById: user.userId,
  }));

  const notifications = await prisma.notification.createMany({
    data: notificationsData,
  });

  return createdResponse({
    success: true,
    message: `تم إرسال الإشعار إلى ${users.length} مستخدم`,
    count: notifications.count,
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/notifications/broadcast' })
