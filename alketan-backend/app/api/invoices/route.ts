import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, createdResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على جميع الفواتير
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const bookingId = searchParams.get('bookingId')
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const where: any = {}

  // المستخدم العادي يمكنه رؤية فواتيره فقط
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

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
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
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
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
    prisma.invoice.count({ where })
  ])

  return paginatedResponse(invoices, total, page, limit, {
    message: 'تم جلب الفواتير بنجاح'
  })
}

// إنشاء فاتورة جديدة
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.INVOICE_GENERATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإنشاء فاتورة')
  }

  const body = await request.json()
  const { bookingId } = body

  if (!bookingId) {
    return errorResponse('BAD_REQUEST', 'معرف الحجز مطلوب', { status: 400 })
  }

  // التحقق من وجود الحجز
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      invoice: true,
      hotel: true,
      user: true,
    },
  })

  if (!booking) {
    return notFoundResponse('الحجز')
  }

  // التحقق من وجود فاتورة سابقة
  if (booking.invoice) {
    return errorResponse('CONFLICT', 'يوجد فاتورة بالفعل لهذا الحجز', { status: 400 })
  }

  // إنشاء رقم الفاتورة
  const invoiceNumber = `INV-${Date.now()}-${booking.id.substring(0, 8).toUpperCase()}`

  // حساب الضريبة (افتراضي 15%)
  const tax = booking.totalPrice * 0.15
  const total = booking.totalPrice + tax

  const invoice = await prisma.invoice.create({
    data: {
      bookingId,
      invoiceNumber,
      subtotal: booking.totalPrice,
      tax,
      total,
      amountDue: total,
      status: 'pending',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 يوم
    },
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
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'INVOICE_GENERATED',
    resource: 'invoice',
    resourceId: invoice.id,
    details: { invoiceNumber, bookingId, total },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({ invoice }, {
    message: 'تم إنشاء الفاتورة بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/invoices' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/invoices' })
