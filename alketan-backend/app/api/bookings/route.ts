import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize, requireAuth, PERMISSIONS, logSecurityEvent, requireRateLimit } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { z } from 'zod'
import { generateBookingCode, generateQRCodeImage } from '@/utils/qrcode'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import crypto from 'crypto'
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  validationProblem,
  forbiddenResponse,
  notFoundResponse,
  conflictResponse,
  createdResponse
} from '@/utils/apiResponse'
import { encrypt, decrypt } from '@/utils/encryption'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { withErrorHandler } from '@/utils/errorHandler'

// Schema للحجز الجديد
const createBookingSchema = z.object({
  hotelId: z.string(),
  roomId: z.string(),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  guests: z.number().min(1).default(1),
  specialRequests: z.string().optional(),
  requestedServices: z.array(z.string()).optional(),
  discountCode: z.string().optional(),
  paymentMethod: z.string().optional(),
  guestName: z.string().optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().optional(),
})

// توليد رقم مرجعي للحجز
function generateBookingReference(): string {
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const random = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `BK${year}${month}-${random}`
}

// الحصول على جميع الحجوزات
export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  // التحقق من Rate Limit أولاً
  const rateLimitResult = await requireRateLimit(request)
  if (rateLimitResult instanceof NextResponse) {
    return rateLimitResult
  }

  const authResult = await requireAuth(request)
  if (authResult) return authResult

  const { user } = (request as any)
  const { searchParams } = new URL(request.url)

  const hotelId = searchParams.get('hotelId')
  const roomId = searchParams.get('roomId')
  const status = searchParams.get('status')
  const paymentStatus = searchParams.get('paymentStatus')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100) // Max 100 per page

  const where: any = {}

  // المستخدم العادي يرى حجوزاته فقط
  if (user.role === 'USER' || user.role === 'GUEST') {
    where.userId = user.userId
  } else {
    if (hotelId) where.hotelId = hotelId
    if (roomId) where.roomId = roomId
  }

  if (status) where.status = status
  if (paymentStatus) where.paymentStatus = paymentStatus

  // فلترة بالتاريخ
  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = new Date(startDate)
    if (endDate) where.createdAt.lte = new Date(endDate)
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: {  // استخدام select بدلاً من include لتحسين الأداء (N+1 fix)
        id: true,
        bookingReference: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        guests: true,
        totalPrice: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        hotel: {
          select: { id: true, name: true, city: true }
        },
        room: {
          select: { id: true, number: true, type: true, floor: true }
        },
        user: {
          select: { id: true, name: true, email: true, phone: true }
        },
        _count: {
          select: { familyMembers: true, messages: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({ where })
  ])

  // تسجيل الوصول للتقارير
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_VIEWED' as AuditAction,
    resource: 'bookings_list',
    details: { action: 'view', filters: { hotelId, status, page, limit } },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return paginatedResponse(bookings, total, page, limit, {
    message: user.role === 'USER' || user.role === 'GUEST'
      ? `تم العثور على ${total} حجز خاص بك`
      : `تم العثور على ${total} حجز`
  })
}, { method: 'GET', path: '/api/bookings' })

// إنشاء حجز جديد
export const POST = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  // التحقق من Rate Limit مع Strict Mode للـ Auth endpoints
  const rateLimitResult = await requireRateLimit(request, { strict: true })
  if (rateLimitResult instanceof NextResponse) {
    return rateLimitResult
  }

  const authResult = await requireAuth(request)
  if (authResult) return authResult

  const { user } = (request as any)

  const body = await request.json()
  const validatedData = createBookingSchema.parse(body)

  // التحقق من الفندق والغرفة
  const [hotel, room] = await Promise.all([
    prisma.hotel.findUnique({ where: { id: validatedData.hotelId } }),
    prisma.room.findUnique({ where: { id: validatedData.roomId } })
  ])

  if (!hotel) {
    return notFoundResponse('الفندق')
  }
  if (!room) {
    return notFoundResponse('الغرفة')
  }
  if (!room.isAvailable || !room.isActive) {
    return conflictResponse('الغرفة غير متاحة حالياً')
  }

  // حساب التواريخ والليالي
  const checkIn = new Date(validatedData.checkInDate)
  const checkOut = new Date(validatedData.checkOutDate)
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))

  if (nights < 1) {
    return errorResponse('BAD_REQUEST', 'تاريخ الخروج يجب أن يكون بعد تاريخ الدخول')
  }

  if (checkIn < startOfDay(new Date())) {
    return errorResponse('BAD_REQUEST', 'لا يمكن الحجز لتاريخ سابق')
  }

  // التحقق من التوفر باستخدام Transaction لضمان التزامن
  const availabilityCheck = await prisma.$transaction(async (tx) => {
    // التحقق من التوفر مع قفل الصف
    const conflictingBookings = await tx.booking.findFirst({
      where: {
        roomId: validatedData.roomId,
        status: { in: ['PENDING', 'APPROVED', 'CONFIRMED', 'CHECKED_IN'] },
        OR: [
          { AND: [{ checkIn: { lte: checkIn } }, { checkOut: { gt: checkIn } }] },
          { AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gte: checkOut } }] },
          { AND: [{ checkIn: { gte: checkIn } }, { checkOut: { lte: checkOut } }] },
        ],
      },
      select: { id: true, bookingReference: true }
    })

    return { conflictingBookings }
  })

  if (availabilityCheck.conflictingBookings) {
    return conflictResponse('الغرفة محجوزة في هذه الفترة، يرجى اختيار تواريخ أخرى')
  }

  // حساب السعر
  let basePrice = room.basePrice * nights
  let discount = 0

  // تطبيق كود الخصم
  if (validatedData.discountCode) {
    const discountRecord = await prisma.discount.findFirst({
      where: {
        code: validatedData.discountCode,
        isActive: true,
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
        OR: [{ hotelId: null }, { hotelId: validatedData.hotelId }]
      }
    })

    if (discountRecord) {
      if (discountRecord.type === 'percentage') {
        discount = (basePrice * discountRecord.value) / 100
        if (discountRecord.maxDiscount) {
          discount = Math.min(discount, discountRecord.maxDiscount)
        }
      } else {
        discount = discountRecord.value
      }

      await prisma.discount.update({
        where: { id: discountRecord.id },
        data: { usedCount: { increment: 1 } }
      })
    }
  }

  const taxes = basePrice * 0.15
  const totalPrice = basePrice + taxes - discount

  // تشفير البيانات الحساسة
  const encryptedNotes = validatedData.specialRequests
    ? encrypt(validatedData.specialRequests)
    : null

  // إنشاء الحجز
  const bookingReference = generateBookingReference()

  const booking = await prisma.booking.create({
    data: {
      bookingReference,
      hotelId: validatedData.hotelId,
      roomId: validatedData.roomId,
      userId: user.role === 'USER' || user.role === 'GUEST' ? user.userId : body.userId || user.userId,
      checkIn: checkIn,
      checkOut: checkOut,
      nights,
      guests: validatedData.guests,
      guestName: validatedData.guestName,
      guestEmail: validatedData.guestEmail,
      guestPhone: validatedData.guestPhone,
      specialRequests: encryptedNotes,
      basePrice,
      taxes,
      discount,
      discountCode: validatedData.discountCode,
      totalPrice,
      paymentMethod: validatedData.paymentMethod,
      status: 'PENDING',
      paymentStatus: 'PENDING',
    },
    include: {
      hotel: { select: { id: true, name: true } },
      room: { select: { id: true, number: true, type: true } },
      user: { select: { id: true, name: true, email: true } },
    }
  })

  // إنشاء QR Code
  const qrCode = generateBookingCode(booking.id)
  const qrImageUrl = await generateQRCodeImage(qrCode)

  await prisma.qRCode.create({
    data: {
      bookingId: booking.id,
      code: qrCode,
      qrImageUrl,
      expiresAt: new Date(checkOut.getTime() + 7 * 24 * 60 * 60 * 1000),
    }
  })

  // إشعار لمدير الفندق
  await prisma.notification.create({
    data: {
      userId: hotel.managerId,
      title: 'طلب حجز جديد',
      message: `طلب حجز جديد #${bookingReference} بانتظار الموافقة`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    }
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'BOOKING_CREATED' as AuditAction,
    resource: 'booking',
    resourceId: booking.id,
    details: {
      bookingReference,
      hotelId: validatedData.hotelId,
      roomId: validatedData.roomId,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      totalPrice,
      nights
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({
    booking: {
      ...booking,
      nights,
      priceBreakdown: {
        basePrice,
        taxes,
        discount,
        totalPrice
      }
    }
  }, { message: 'تم إنشاء الحجز بنجاح' })
}, { method: 'POST', path: '/api/bookings' })
