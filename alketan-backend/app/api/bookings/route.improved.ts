// مثال على استخدام Background Jobs في Booking
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize, createErrorResponse, createSuccessResponse } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { bookingSchema } from '@/utils/validation'
import { generateBookingCode, generateQRCodeImage } from '@/utils/qrcode'
import { addEmailJob, addNotificationJob } from '@/lib/queue'
import { handleError, withErrorHandler } from '@/utils/errorHandler'
import { logInfo } from '@/utils/logger'
import crypto from 'crypto'

// توليد رقم مرجعي للحجز
function generateBookingReference(): string {
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const random = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `BK${year}${month}-${random}`
}

async function createBookingHandler(request: Request) {
  try {
    const user = await authenticate(request as NextRequest)
    if (!user) {
      return createErrorResponse('غير مصرح لك', 401)
    }

    if (!authorize(user, PermissionType.BOOKING_CREATE)) {
      return createErrorResponse('ليس لديك صلاحية لإنشاء حجز', 403)
    }

    const body = await request.json()
    const validatedData = bookingSchema.parse(body)

    // ... (كود التحقق من الفندق والغرفة كما هو موجود)
    const room = await prisma.room.findUnique({ where: { id: validatedData.roomId } })
    if (!room) return createErrorResponse('الغرفة غير موجودة', 404)

    const checkIn = new Date(validatedData.checkIn)
    const checkOut = new Date(validatedData.checkOut)
    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))
    const basePrice = room.basePrice * nights
    const taxes = basePrice * 0.15
    const totalPrice = basePrice + taxes

    // إنشاء الحجز
    const booking = await prisma.booking.create({
      data: {
        bookingReference: generateBookingReference(),
        hotelId: validatedData.hotelId,
        roomId: validatedData.roomId,
        userId: user.userId,
        checkIn: checkIn,
        checkOut: checkOut,
        nights: nights,
        guests: validatedData.guests,
        basePrice: basePrice,
        taxes: taxes,
        totalPrice: totalPrice,
        specialRequests: validatedData.specialRequests,
        status: 'PENDING',
        paymentStatus: 'PENDING',
      },
      include: {
        hotel: true,
        room: true,
        user: true,
      },
    })

    // إنشاء QR Code
    const bookingCode = generateBookingCode(booking.id)
    const qrImageUrl = await generateQRCodeImage(bookingCode)

    await prisma.qRCode.create({
      data: {
        bookingId: booking.id,
        code: bookingCode,
        qrImageUrl,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    // إرسال إيميل التأكيد في Background Job
    await addEmailJob({
      to: booking.user.email,
      subject: 'تأكيد الحجز',
      template: 'booking-confirmation',
      variables: {
        bookingId: booking.id,
        hotelName: booking.hotel.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
      },
    })

    // إرسال إشعار في Background Job
    await addNotificationJob({
      userId: user.userId,
      title: 'تم إنشاء الحجز بنجاح',
      message: `تم إنشاء حجزك في ${booking.hotel.name}`,
      type: 'booking',
      link: `/bookings/${booking.id}`,
    })

    logInfo('Booking created with background jobs', { bookingId: booking.id })

    return createSuccessResponse({ booking }, 201)
  } catch (error) {
    return handleError(error, {
      method: 'POST',
      path: '/api/bookings',
    })
  }
}

export const POST = withErrorHandler(createBookingHandler, {
  method: 'POST',
  path: '/api/bookings',
})
