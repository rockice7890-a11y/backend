import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// تسجيل دخول (Check-in)
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
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لتسجيل الدخول', { status: 403 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      room: true,
    },
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (booking.status !== 'CONFIRMED') {
    return errorResponse('BAD_REQUEST', 'الحجز غير مؤكد', { status: 400 })
  }

  // تحديث حالة الحجز
  const updatedBooking = await prisma.booking.update({
    where: { id },
    data: {
      status: 'CHECKED_IN',
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
          name: true,
          email: true,
        },
      },
      qrCode: true,
    },
  })

  // تحديث حالة الغرفة
  await prisma.room.update({
    where: { id: booking.roomId },
    data: {
      isAvailable: false,
    },
  })

  return successResponse({
    message: 'تم تسجيل الدخول بنجاح',
    booking: updatedBooking
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/check-in' })
