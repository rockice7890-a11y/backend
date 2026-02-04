import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

const serviceRequestSchema = z.object({
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  quantity: z.number().min(1).default(1),
  notes: z.string().optional(),
  urgency: z.enum(['normal', 'urgent']).default('normal'),
})

// طلب خدمة من النزيل
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
  const validatedData = serviceRequestSchema.parse(body)

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { hotel: true, room: true }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // التحقق من أن النزيل هو صاحب الحجز أو موظف
  if (booking.userId !== user.userId && !['ADMIN', 'HOTEL_MANAGER', 'RECEPTIONIST'].includes(user.role)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  // التحقق من أن الحجز في حالة CHECKED_IN
  if (booking.status !== 'CHECKED_IN') {
    return errorResponse('BAD_REQUEST', 'يجب أن يكون الحجز في حالة تسجيل دخول', { status: 400 })
  }

  let service = null
  let price = 0

  // إذا تم تحديد خدمة من القائمة
  if (validatedData.serviceId) {
    service = await prisma.service.findUnique({
      where: { id: validatedData.serviceId }
    })
    if (!service) {
      return errorResponse('NOT_FOUND', 'الخدمة غير موجودة', { status: 404 })
    }
    price = service.price * validatedData.quantity
  }

  // إنشاء طلب الخدمة
  const serviceRequest = await prisma.bookingService.create({
    data: {
      bookingId: id,
      serviceId: validatedData.serviceId || '',
      quantity: validatedData.quantity,
      price: price,
      status: 'PENDING',
      notes: validatedData.notes,
      urgency: validatedData.urgency,
      requestedAt: new Date(),
      requestedBy: user.userId,
    }
  })

  // إرسال رسالة للحجز
  await prisma.bookingMessage.create({
    data: {
      bookingId: id,
      senderId: user.userId,
      senderType: 'guest',
      message: `طلب خدمة: ${service?.name || validatedData.serviceName} (الكمية: ${validatedData.quantity})${validatedData.notes ? ` - ملاحظات: ${validatedData.notes}` : ''}`,
      messageType: 'info',
    }
  })

  // إشعار للموظفين
  await prisma.notification.create({
    data: {
      userId: booking.hotel.managerId,
      title: 'طلب خدمة جديد',
      message: `طلب خدمة من الغرفة ${booking.room.number} - ${service?.name || validatedData.serviceName}`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    }
  })

  return createdResponse({
    message: 'تم إرسال طلب الخدمة بنجاح',
    serviceRequest
  })
}

// الحصول على طلبات الخدمات
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { userId: true }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (booking.userId !== user.userId && !['ADMIN', 'HOTEL_MANAGER', 'RECEPTIONIST', 'ACCOUNTANT'].includes(user.role)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const services = await prisma.bookingService.findMany({
    where: { bookingId: id },
    include: {
      service: true
    },
    orderBy: { createdAt: 'desc' }
  })

  const totalServices = services.reduce((sum, s) => sum + s.price, 0)

  return successResponse({
    services,
    totalServices
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/request-service' })
export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/request-service' })
