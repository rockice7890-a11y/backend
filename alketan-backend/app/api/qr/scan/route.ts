import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { validateBookingCode } from '@/utils/qrcode'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لمسح QR Code')
  }

  const body = await request.json()
  const { code } = body

  if (!code) {
    return errorResponse('BAD_REQUEST', 'رمز QR Code مطلوب', { status: 400 })
  }

  // التحقق من صحة تنسيق الكود
  if (!validateBookingCode(code)) {
    return errorResponse('BAD_REQUEST', 'رمز QR Code غير صحيح', { status: 400 })
  }

  // البحث عن QR Code
  const qrCode = await prisma.qRCode.findUnique({
    where: { code },
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

  if (!qrCode) {
    return notFoundResponse('رمز QR Code')
  }

  // التحقق من انتهاء صلاحية QR Code
  if (qrCode.expiresAt && new Date() > qrCode.expiresAt) {
    return errorResponse('BAD_REQUEST', 'رمز QR Code منتهي الصلاحية', { status: 400 })
  }

  // التحقق من حالة الحجز
  if (qrCode.booking.status === 'CANCELLED') {
    return errorResponse('BAD_REQUEST', 'الحجز ملغي', { status: 400 })
  }

  // تحديث حالة QR Code
  const updatedQRCode = await prisma.qRCode.update({
    where: { id: qrCode.id },
    data: {
      isScanned: true,
      scannedAt: new Date(),
      scannedBy: user.userId,
    },
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

  return successResponse({
    message: 'تم مسح QR Code بنجاح',
    qrCode: updatedQRCode,
    booking: updatedQRCode.booking,
  })
}

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const bookingId = searchParams.get('bookingId')

  if (!code && !bookingId) {
    return errorResponse('BAD_REQUEST', 'رمز QR Code أو معرف الحجز مطلوب', { status: 400 })
  }

  const where: any = {}
  if (code) where.code = code
  if (bookingId) where.bookingId = bookingId

  const qrCode = await prisma.qRCode.findFirst({
    where,
    include: {
      booking: {
        include: {
          hotel: {
            select: {
              id: true,
              name: true,
              nameAr: true,
              city: true,
              address: true,
            },
          },
          room: {
            select: {
              id: true,
              number: true,
              type: true,
              floor: true,
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

  if (!qrCode) {
    return notFoundResponse('رمز QR Code')
  }

  // التحقق من الصلاحيات: المستخدم يمكنه رؤية QR Code لحجوزاته فقط
  if (user.role === 'USER' && qrCode.booking.userId !== user.userId) {
    return forbiddenResponse('ليس لديك صلاحية لعرض هذا QR Code')
  }

  return successResponse({ qrCode })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/qr/scan' })
export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/qr/scan' })
