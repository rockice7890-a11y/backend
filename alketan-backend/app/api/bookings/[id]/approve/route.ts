import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, conflictResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { checkOptimisticLock } from '@/utils/optimisticLock'
import { withErrorHandler } from '@/utils/errorHandler'

// الموافقة على الحجز مع Optimistic Locking
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
  const { message, staffNotes, expectedVersion } = body

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      version: true,
      bookingReference: true,
      userId: true,
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
      hotel: {
        select: { id: true, name: true },
      },
      room: {
        select: { id: true, number: true, type: true },
      },
    },
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (booking.status !== 'PENDING') {
    return errorResponse('BAD_REQUEST', 'لا يمكن الموافقة على هذا الحجز، الحالة الحالية: ' + booking.status, { status: 400 })
  }

  // التحقق من Optimistic Locking
  if (expectedVersion !== undefined) {
    const { current, isConflict } = await checkOptimisticLock(id, expectedVersion, 'booking')
    
    if (isConflict && current) {
      return conflictResponse(
        'تم تعديل هذا الحجز من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.',
        {
          details: {
            currentVersion: current.version,
            currentStatus: current.status,
            currentPaymentStatus: current.paymentStatus,
            lastUpdated: current.updatedAt?.toISOString() || null,
          }
        }
      )
    }
  }

  // تحديث الحجز مع Optimistic Locking
  const updatedBooking = await prisma.booking.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      approvedBy: user.userId,
      approvedAt: new Date(),
      staffNotes: staffNotes || null,
      version: { increment: 1 },
    },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      hotel: { select: { id: true, name: true } },
      room: { select: { id: true, number: true, type: true } },
    },
  })

  // إرسال رسالة للنزيل
  if (message) {
    await prisma.bookingMessage.create({
      data: {
        bookingId: id,
        senderId: user.userId,
        senderType: 'staff',
        message: message,
        messageType: 'approval',
      },
    })
  }

  // إنشاء إشعار للنزيل
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: 'تمت الموافقة على حجزك',
      message: `تمت الموافقة على حجزك في ${booking.hotel.name}. يرجى استكمال البيانات المطلوبة.`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_APPROVED' as AuditAction,
    resource: 'booking',
    resourceId: id,
    details: {
      bookingReference: booking.bookingReference,
      fromVersion: expectedVersion || booking.version - 1,
      toVersion: updatedBooking.version,
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  })

  return successResponse({
    message: 'تمت الموافقة على الحجز بنجاح',
    booking: updatedBooking,
    version: updatedBooking.version,
    nextStep: 'يرجى استكمال بيانات النزيل',
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/approve' })
