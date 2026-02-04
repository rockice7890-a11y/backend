import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لمعالجة الخروج التلقائي')
  }

  const body = await request.json()
  const { bookingId } = body

  if (!bookingId) {
    return validationProblem([{ field: 'bookingId', message: 'معرف الحجز مطلوب' }])
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      hotel: true,
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  if (booking.status !== 'CHECKED_IN') {
    return errorResponse('BAD_REQUEST', 'الحجز ليس في حالة تسجيل دخول')
  }

  const now = new Date()
  const checkOutDate = new Date(booking.checkOut)

  // التحقق من أن تاريخ الخروج قد مر
  if (now < checkOutDate) {
    return errorResponse('BAD_REQUEST', 'لم يحن موعد الخروج بعد')
  }

  // تحديث حالة الحجز
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CHECKED_OUT',
    },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
      room: {
        select: {
          id: true,
          number: true,
          type: true,
        },
      },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  })

  // تحديث حالة الغرفة
  await prisma.room.update({
    where: { id: booking.roomId },
    data: {
      isAvailable: true,
      status: 'AVAILABLE',
    },
  })

  // إنشاء إشعار للمستخدم
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: 'تم تسجيل الخروج',
      message: `تم تسجيل خروجك من ${booking.hotel.name} تلقائياً. نتمنى أن تكون قد استمتعت بإقامتك!`,
      type: 'booking',
      link: `/bookings/${bookingId}`,
    },
  })

  return successResponse({
    booking: updatedBooking
  }, { message: 'تم معالجة الخروج التلقائي بنجاح' })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/auto-checkout/process' })
