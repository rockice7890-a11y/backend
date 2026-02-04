import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, conflictResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على حجز محدد
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          nameAr: true,
          city: true,
          address: true,
          phone: true,
        },
      },
      room: {
        select: {
          id: true,
          number: true,
          type: true,
          floor: true,
          capacity: true,
          amenities: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      qrCode: true,
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  // التحقق من الصلاحيات: المستخدم يمكنه رؤية حجوزاته فقط
  if (user.role === 'USER' && booking.userId !== user.userId) {
    return forbiddenResponse('ليس لديك صلاحية لعرض هذا الحجز')
  }

  // تسجيل الوصول
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_VIEWED' as AuditAction,
    resource: 'booking',
    resourceId: booking.id,
    details: { action: 'view_single' },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ booking })
}, { method: 'GET', path: '/api/bookings/[id]' })

// تحديث حجز مع Optimistic Locking
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // قراءة body الطلب للحصول على expectedVersion
  const body = await request.json()
  const expectedVersion = body.expectedVersion

  // الحصول على الحجز الحالي مع version
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      paymentStatus: true,
      version: true,
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  // التحقق من الصلاحيات
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذا الحجز')
  }

  // التحقق من Optimistic Locking
  if (expectedVersion !== undefined && booking.version !== expectedVersion) {
    // تم تعديل الحجز من قبل مستخدم آخر
    const currentBooking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        version: true,
        updatedAt: true,
      },
    })

    return conflictResponse(
      'تم تعديل هذا الحجز من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.',
      {
        details: {
          currentVersion: currentBooking?.version || booking.version,
          currentStatus: currentBooking?.status || booking.status,
          currentPaymentStatus: currentBooking?.paymentStatus || booking.paymentStatus,
          lastUpdated: currentBooking?.updatedAt?.toISOString() || null,
        }
      }
    )
  }

  const updateData: any = {}

  if (body.status) {
    updateData.status = body.status

    // عند تأكيد الحجز، تحديث حالة الدفع
    if (body.status === 'CONFIRMED' && booking.paymentStatus === 'PENDING') {
      updateData.paymentStatus = 'PAID'
    }
  }

  if (body.paymentStatus) {
    updateData.paymentStatus = body.paymentStatus
  }

  if (body.specialRequests !== undefined) {
    updateData.specialRequests = body.specialRequests
  }

  // إضافة Optimistic Locking: increment version
  updateData.version = { increment: 1 }

  const updatedBooking = await prisma.booking.update({
    where: { id },
    data: updateData,
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
          address: true,
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

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_UPDATED' as AuditAction,
    resource: 'booking',
    resourceId: id,
    details: {
      changes: Object.keys(updateData).filter(k => k !== 'version'),
      status: updateData.status,
      paymentStatus: updateData.paymentStatus,
      fromVersion: booking.version,
      toVersion: updatedBooking.version,
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ 
    booking: updatedBooking,
    version: updatedBooking.version,
  }, { message: 'تم تحديث الحجز بنجاح' })
}, { method: 'PATCH', path: '/api/bookings/[id]' })

// إلغاء حجز مع Optimistic Locking
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // قراءة query params للحصول على expectedVersion
  const { searchParams } = new URL(request.url)
  const expectedVersion = searchParams.get('version') ? parseInt(searchParams.get('version')!) : undefined

  // الحصول على الحجز الحالي مع version
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      paymentStatus: true,
      version: true,
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  // التحقق من الصلاحيات
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_CANCEL)) {
    return forbiddenResponse('ليس لديك صلاحية لإلغاء هذا الحجز')
  }

  // التحقق من Optimistic Locking
  if (expectedVersion !== undefined && booking.version !== expectedVersion) {
    const currentBooking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        version: true,
        updatedAt: true,
      },
    })

    return conflictResponse(
      'تم تعديل هذا الحجز من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.',
      {
        details: {
          currentVersion: currentBooking?.version || booking.version,
          currentStatus: currentBooking?.status || booking.status,
          currentPaymentStatus: currentBooking?.paymentStatus || booking.paymentStatus,
          lastUpdated: currentBooking?.updatedAt?.toISOString() || null,
        }
      }
    )
  }

  // تحديث حالة الحجز إلى ملغي مع Optimistic Locking
  const cancelledBooking = await prisma.booking.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      paymentStatus: booking.paymentStatus === 'PAID' ? 'REFUNDED' : 'PENDING',
      version: { increment: 1 },
    },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
        },
      },
      room: {
        select: {
          id: true,
          number: true,
        },
      },
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_CANCELLED' as AuditAction,
    resource: 'booking',
    resourceId: id,
    details: {
      bookingReference: cancelledBooking.bookingReference,
      hotelId: cancelledBooking.hotelId,
      fromVersion: booking.version,
      toVersion: cancelledBooking.version,
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({
    message: 'تم إلغاء الحجز بنجاح',
    booking: cancelledBooking,
    version: cancelledBooking.version,
  }, { message: 'تم إلغاء الحجز بنجاح' })
}, { method: 'DELETE', path: '/api/bookings/[id]' })
