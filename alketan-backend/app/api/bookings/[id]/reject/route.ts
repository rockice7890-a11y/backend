import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// رفض الحجز
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const body = await request.json()
  const { reason, message } = body

  if (!reason) {
    return errorResponse('BAD_REQUEST', 'سبب الرفض مطلوب', { status: 400 })
  }

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { user: true, hotel: true }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (!['PENDING', 'APPROVED'].includes(booking.status)) {
    return errorResponse('BAD_REQUEST', 'لا يمكن رفض هذا الحجز', { status: 400 })
  }

  // تحديث الحجز
  const updatedBooking = await prisma.booking.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      rejectedBy: user.userId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      hotel: { select: { id: true, name: true } },
      room: { select: { id: true, number: true } },
    }
  })

  // إرسال رسالة للنزيل
  const fullMessage = message || `نعتذر، تم رفض حجزك. السبب: ${reason}`
  await prisma.bookingMessage.create({
    data: {
      bookingId: id,
      senderId: user.userId,
      senderType: 'staff',
      message: fullMessage,
      messageType: 'rejection',
    }
  })

  // إنشاء إشعار للنزيل
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: 'تم رفض حجزك',
      message: `نعتذر، تم رفض حجزك في ${booking.hotel.name}. السبب: ${reason}`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    }
  })

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'REJECT_BOOKING',
      resource: 'booking',
      resourceId: id,
      details: JSON.stringify({ reason }),
    }
  })

  return successResponse({
    message: 'تم رفض الحجز',
    booking: updatedBooking
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/reject' })
