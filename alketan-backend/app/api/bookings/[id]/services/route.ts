import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

const bookingServiceSchema = z.object({
  serviceId: z.string().min(1, 'معرف الخدمة مطلوب'),
  quantity: z.number().int().positive().default(1),
})

// الحصول على خدمات الحجز
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
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // التحقق من الصلاحيات
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لعرض خدمات هذا الحجز', { status: 403 })
  }

  const bookingServices = await prisma.bookingService.findMany({
    where: { bookingId: id },
    include: {
      service: {
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

  return successResponse({ bookingServices })
}

// إضافة خدمة للحجز
const handlePost = async (
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
    include: {
      hotel: true,
    },
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // التحقق من الصلاحيات
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لإضافة خدمات لهذا الحجز', { status: 403 })
  }

  const body = await request.json()
  const validatedData = bookingServiceSchema.parse(body)

  // التحقق من وجود الخدمة
  const service = await prisma.service.findUnique({
    where: { id: validatedData.serviceId },
  })

  if (!service) {
    return errorResponse('NOT_FOUND', 'الخدمة غير موجودة', { status: 404 })
  }

  // التحقق من أن الخدمة تنتمي لنفس الفندق
  if (service.hotelId !== booking.hotelId) {
    return errorResponse('BAD_REQUEST', 'الخدمة لا تنتمي لنفس فندق الحجز', { status: 400 })
  }

  // التحقق من أن الخدمة نشطة
  if (!service.isActive) {
    return errorResponse('BAD_REQUEST', 'الخدمة غير نشطة', { status: 400 })
  }

  // حساب السعر
  const price = service.price * validatedData.quantity

  // إنشاء أو تحديث خدمة الحجز
  const bookingService = await prisma.bookingService.create({
    data: {
      bookingId: id,
      serviceId: validatedData.serviceId,
      quantity: validatedData.quantity,
      price,
      requestedBy: user.userId,
    },
    include: {
      service: {
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

  // تحديث السعر الإجمالي للحجز
  const allServices = await prisma.bookingService.findMany({
    where: { bookingId: id },
  })

  const servicesTotal = allServices.reduce((sum, s) => sum + s.price, 0)
  const newTotalPrice = booking.totalPrice + servicesTotal

  await prisma.booking.update({
    where: { id },
    data: {
      totalPrice: newTotalPrice,
    },
  })

  return createdResponse({ bookingService })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/services' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/services' })
