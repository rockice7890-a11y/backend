import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على دفعة محددة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      booking: {
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
              phone: true,
            },
          },
        },
      },
    },
  })

  if (!payment) {
    return notFoundResponse('الدفعة')
  }

  // التحقق من الصلاحيات
  if ((user.role === 'USER' || user.role === 'GUEST') && payment.booking.userId !== user.userId) {
    return forbiddenResponse('ليس لديك صلاحية لعرض هذه الدفعة')
  }

  return successResponse({ payment })
}

// تحديث حالة الدفعة
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.FINANCIAL_VIEW)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث الدفعات')
  }

  const body = await request.json()
  const { status, refundedAt } = body

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      booking: true,
    },
  })

  if (!payment) {
    return notFoundResponse('الدفعة')
  }

  const updateData: any = {}
  if (status) updateData.status = status
  if (refundedAt) updateData.refundedAt = new Date(refundedAt)

  // إذا تم استرداد الدفعة، تحديث حالة الحجز
  if (status === 'refunded') {
    await prisma.booking.update({
      where: { id: payment.bookingId },
      data: {
        paymentStatus: 'REFUNDED',
        status: 'CANCELLED',
      },
    })
  }

  const updatedPayment = await prisma.payment.update({
    where: { id },
    data: updateData,
    include: {
      booking: {
        include: {
          hotel: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  })

  return successResponse({ payment: updatedPayment })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/payments/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/payments/[id]' })
