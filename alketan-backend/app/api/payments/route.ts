import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, createdResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// التحقق من بيانات الدفع
const paymentSchema = z.object({
  bookingId: z.string().min(1, 'معرف الحجز مطلوب'),
  amount: z.number().positive('المبلغ يجب أن يكون قيمة موجبة'),
  method: z.string().min(1, 'طريقة الدفع مطلوبة'),
  currency: z.string().default('USD'),
  transactionId: z.string().optional(),
  stripeId: z.string().optional(),
})

// الحصول على جميع المدفوعات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // Add authorization for viewing payments
  if (!authorize(user, PermissionType.FINANCIAL_VIEW)) {
    return forbiddenResponse('ليس لديك صلاحية لعرض الدفعات')
  }

  const { searchParams } = new URL(request.url)
  const bookingId = searchParams.get('bookingId')
  const status = searchParams.get('status')
  const method = searchParams.get('method')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const paymentId = searchParams.get('paymentId') // Added for fetching a single payment

  const where: any = {}

  if (paymentId) {
    where.id = paymentId
  }

  // المستخدم العادي يمكنه رؤية مدفوعاته فقط
  if (user.role === 'USER' || user.role === 'GUEST') {
    const userBookings = await prisma.booking.findMany({
      where: { userId: user.userId },
      select: { id: true },
    })
    where.bookingId = { in: userBookings.map(b => b.id) }
  } else {
    if (bookingId) where.bookingId = bookingId
  }

  if (status) where.status = status
  if (method) where.method = method

  if (paymentId) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: {
          include: {
            hotel: {
              select: {
                id: true,
                name: true,
                city: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    })

    if (!payment) {
      return notFoundResponse('الدفعة')
    }

    // Check if user owns the booking for the payment (for regular users)
    if ((user.role === 'USER' || user.role === 'GUEST') && payment.booking.userId !== user.userId) {
      return forbiddenResponse('ليس لديك صلاحية لعرض هذه الدفعة')
    }

    return successResponse({ payment }, { message: 'تم جلب الدفعة بنجاح' })
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        booking: {
          include: {
            hotel: {
              select: {
                id: true,
                name: true,
                city: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where })
  ])

  return paginatedResponse(payments, total, page, limit, {
    message: 'تم جلب المدفوعات بنجاح'
  })
}

// معالجة دفعة جديدة
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.PAYMENT_PROCESS)) {
    return forbiddenResponse('ليس لديك صلاحية لمعالجة الدفعات')
  }

  const body = await request.json()
  const validatedData = paymentSchema.parse(body)

  // التحقق من وجود الحجز
  const booking = await prisma.booking.findUnique({
    where: { id: validatedData.bookingId },
    include: {
      payment: true,
      hotel: {
        select: {
          id: true,
          name: true
        }
      }
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  // التحقق من أن الحجز لم يتم دفعه بالفعل
  if (booking.payment && booking.payment.status === 'completed') {
    return errorResponse('CONFLICT', 'تم دفع هذا الحجز بالفعل', { status: 400 })
  }

  // التحقق من أن المستخدم يملك الحجز (للمستخدمين العاديين)
  if ((user.role === 'USER' || user.role === 'GUEST') && booking.userId !== user.userId) {
    return forbiddenResponse('ليس لديك صلاحية لدفع هذا الحجز')
  }

  // إنشاء أو تحديث الدفعة
  let payment
  if (booking.payment) {
    payment = await prisma.payment.update({
      where: { id: booking.payment.id },
      data: {
        amount: validatedData.amount,
        currency: validatedData.currency,
        method: validatedData.method,
        status: 'completed',
        transactionId: validatedData.transactionId,
        stripeId: validatedData.stripeId,
        paidAt: new Date(),
      },
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
  } else {
    payment = await prisma.payment.create({
      data: {
        bookingId: validatedData.bookingId,
        amount: validatedData.amount,
        currency: validatedData.currency,
        method: validatedData.method,
        status: 'completed',
        transactionId: validatedData.transactionId,
        stripeId: validatedData.stripeId,
        paidAt: new Date(),
      },
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
  }

  // تحديث حالة الحجز والدفع
  await prisma.booking.update({
    where: { id: validatedData.bookingId },
    data: {
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'PAYMENT_RECEIVED',
    resource: 'payment',
    resourceId: payment.id,
    details: {
      amount: validatedData.amount,
      currency: validatedData.currency,
      method: validatedData.method,
      bookingId: validatedData.bookingId,
      hotelName: booking.hotel?.name
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  })

  return createdResponse({ payment }, {
    message: 'تم معالجة الدفعة بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/payments' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/payments' })
