import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import crypto from 'crypto'
import { withErrorHandler } from '@/utils/errorHandler'

// توليد رقم الفاتورة
function generateInvoiceNumber(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const random = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `INV-${year}${month}-${random}`
}

// طلب تسجيل المغادرة من النزيل
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const body = await request.json()
  const { reason } = body

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      hotel: true,
      room: true,
      services: { include: { service: true } },
      invoice: true,
    }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // التحقق من الصلاحية
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  if (booking.status !== 'CHECKED_IN') {
    return errorResponse('BAD_REQUEST', 'يجب أن يكون الحجز في حالة تسجيل دخول', { status: 400 })
  }

  // التحقق من عدم وجود طلب مغادرة معلق
  const existingRequest = await prisma.checkoutRequest.findFirst({
    where: { bookingId: id, status: 'PENDING' }
  })

  if (existingRequest) {
    return errorResponse('CONFLICT', 'يوجد طلب مغادرة معلق بالفعل', { status: 400 })
  }

  // حساب تكلفة الخدمات
  const serviceCharges = booking.services.reduce((sum, s) => sum + s.price, 0)

  // إنشاء أو تحديث الفاتورة
  let invoice = booking.invoice
  if (!invoice) {
    invoice = await prisma.invoice.create({
      data: {
        bookingId: id,
        invoiceNumber: generateInvoiceNumber(),
        roomCharges: booking.totalPrice,
        serviceCharges,
        subtotal: booking.totalPrice + serviceCharges,
        tax: (booking.totalPrice + serviceCharges) * 0.15,
        total: (booking.totalPrice + serviceCharges) * 1.15,
        amountDue: (booking.totalPrice + serviceCharges) * 1.15,
      }
    })
  } else {
    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        serviceCharges,
        subtotal: booking.totalPrice + serviceCharges,
        tax: (booking.totalPrice + serviceCharges) * 0.15,
        total: (booking.totalPrice + serviceCharges) * 1.15,
        amountDue: (booking.totalPrice + serviceCharges) * 1.15 - invoice.amountPaid,
      }
    })
  }

  // إنشاء طلب المغادرة
  const checkoutRequest = await prisma.checkoutRequest.create({
    data: {
      bookingId: id,
      requestedBy: user.userId,
      notes: reason,
    }
  })

  // إرسال رسالة
  await prisma.bookingMessage.create({
    data: {
      bookingId: id,
      senderId: user.userId,
      senderType: 'guest',
      message: `طلب تسجيل مغادرة${reason ? ` - السبب: ${reason}` : ''}`,
      messageType: 'info',
    }
  })

  // إشعار للموظفين
  await prisma.notification.create({
    data: {
      userId: booking.hotel.managerId,
      title: 'طلب مغادرة',
      message: `طلب مغادرة من الغرفة ${booking.room.number} - الفاتورة: ${invoice.total.toFixed(2)}`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    }
  })

  return createdResponse({
    message: 'تم إرسال طلب المغادرة، بانتظار موافقة الموظف',
    checkoutRequest,
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      roomCharges: invoice.roomCharges,
      serviceCharges: invoice.serviceCharges,
      tax: invoice.tax,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
    }
  })
}

// الحصول على حالة طلب المغادرة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const checkoutRequest = await prisma.checkoutRequest.findFirst({
    where: { bookingId: id },
    orderBy: { createdAt: 'desc' }
  })

  const invoice = await prisma.invoice.findUnique({
    where: { bookingId: id }
  })

  return successResponse({
    checkoutRequest,
    invoice
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/request-checkout' })
export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/request-checkout' })
