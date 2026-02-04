import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, conflictResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { checkOptimisticLock } from '@/utils/optimisticLock'
import { withErrorHandler } from '@/utils/errorHandler'

// معالجة طلب المغادرة من الموظف مع Optimistic Locking
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
  const {
    action,           // approve, reject
    paymentAction,    // paid, deferred
    paymentMethod,
    amountPaid,
    deferredTo,       // اسم الجهة للترحيل
    deferredReason,
    rejectionReason,
    notes,
    expectedVersion,  // للـ Optimistic Locking
  } = body

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      hotel: true,
      room: true,
      invoice: true,
      user: true,
    },
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (booking.status !== 'CHECKED_IN') {
    return errorResponse('BAD_REQUEST', 'الحجز ليس في حالة تسجيل دخول', { status: 400 })
  }

  // البحث عن طلب المغادرة المعلق
  const checkoutRequest = await prisma.checkoutRequest.findFirst({
    where: { bookingId: id, status: 'PENDING' },
  })

  if (!checkoutRequest) {
    return errorResponse('NOT_FOUND', 'لا يوجد طلب مغادرة معلق', { status: 404 })
  }

  // رفض الطلب
  if (action === 'reject') {
    if (!rejectionReason) {
      return errorResponse('BAD_REQUEST', 'سبب الرفض مطلوب', { status: 400 })
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

    await prisma.checkoutRequest.update({
      where: { id: checkoutRequest.id },
      data: {
        status: 'REJECTED',
        rejectedBy: user.userId,
        rejectedAt: new Date(),
        rejectionReason,
      },
    })

    // إشعار للنزيل
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: 'تم رفض طلب المغادرة',
        message: `تم رفض طلب المغادرة. السبب: ${rejectionReason}`,
        type: 'booking',
      },
    })

    return successResponse({
      message: 'تم رفض طلب المغادرة',
      reason: rejectionReason,
    })
  }

  // الموافقة على الطلب
  if (action === 'approve') {
    if (!booking.invoice) {
      return errorResponse('NOT_FOUND', 'لا توجد فاتورة للحجز', { status: 404 })
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

    const invoice = booking.invoice

    // التحقق من حالة الدفع
    if (paymentAction === 'paid') {
      // تأكيد الدفع
      const requiredAmount = invoice.amountDue || invoice.total
      const paidAmount = amountPaid || requiredAmount

      if (paidAmount < requiredAmount) {
        return errorResponse('BAD_REQUEST', `المبلغ المدفوع أقل من المطلوب (${requiredAmount})`, { status: 400 })
      }

      // تنفيذ جميع التحديثات في معاملة واحدة
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'paid',
            amountPaid: paidAmount,
            amountDue: 0,
            paymentMethod,
            paidAt: new Date(),
          },
        }),
        prisma.checkoutRequest.update({
          where: { id: checkoutRequest.id },
          data: {
            status: 'APPROVED',
            approvedBy: user.userId,
            approvedAt: new Date(),
            paymentStatus: 'PAID',
            notes,
          },
        }),
        prisma.booking.update({
          where: { id },
          data: {
            status: 'CHECKED_OUT',
            paymentStatus: 'PAID',
            version: { increment: 1 },
          },
        }),
        prisma.room.update({
          where: { id: booking.roomId },
          data: { status: 'AVAILABLE' },
        }),
      ])

    } else if (paymentAction === 'deferred') {
      // ترحيل الحساب
      if (!deferredTo) {
        return errorResponse('BAD_REQUEST', 'يجب تحديد الجهة للترحيل', { status: 400 })
      }

      // تنفيذ جميع التحديثات في معاملة واحدة
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'deferred',
            isDeferred: true,
            deferredTo,
            deferredReason,
            deferredApprovedBy: user.userId,
          },
        }),
        prisma.checkoutRequest.update({
          where: { id: checkoutRequest.id },
          data: {
            status: 'APPROVED',
            approvedBy: user.userId,
            approvedAt: new Date(),
            paymentStatus: 'DEFERRED',
            deferredTo,
            deferredReason,
            notes,
          },
        }),
        prisma.booking.update({
          where: { id },
          data: {
            status: 'CHECKED_OUT',
            paymentStatus: 'PENDING',
            version: { increment: 1 },
          },
        }),
        prisma.room.update({
          where: { id: booking.roomId },
          data: { status: 'AVAILABLE' },
        }),
      ])

    } else {
      return errorResponse('BAD_REQUEST', 'يجب تحديد إجراء الدفع (paid أو deferred)', { status: 400 })
    }

    // إشعار للنزيل
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: 'تم تسجيل المغادرة',
        message: `تم تسجيل مغادرتك بنجاح من ${booking.hotel.name}. شكراً لزيارتك!`,
        type: 'booking',
      },
    })

    // رسالة في الحجز
    await prisma.bookingMessage.create({
      data: {
        bookingId: id,
        senderId: user.userId,
        senderType: 'staff',
        message: `تم تسجيل المغادرة بنجاح. ${paymentAction === 'deferred' ? `تم ترحيل الحساب إلى: ${deferredTo}` : 'تم تسديد الفاتورة'}`,
        messageType: 'info',
      },
    })

    // تسجيل في سجل التدقيق
    await createAuditLog({
      userId: user.userId,
      action: 'CHECKOUT_PROCESSED' as AuditAction,
      resource: 'booking',
      resourceId: id,
      details: {
        paymentAction,
        paymentMethod,
        deferredTo,
        invoiceTotal: invoice.total,
        fromVersion: expectedVersion || booking.version,
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    })

    return successResponse({
      message: 'تم تسجيل المغادرة بنجاح',
      booking: {
        id: booking.id,
        status: 'CHECKED_OUT',
      },
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        status: paymentAction === 'paid' ? 'paid' : 'deferred',
        ...(paymentAction === 'deferred' && { deferredTo }),
      },
    })
  }

  return errorResponse('BAD_REQUEST', 'إجراء غير صحيح', { status: 400 })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/process-checkout' })
