import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { Permissions, PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على جميع نزلاء الفندق
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  // التحقق من أن الفندق موجود
  const hotel = await prisma.hotel.findUnique({
    where: { id },
    select: { id: true, managerId: true, hotelCode: true }
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  // التحقق من الصلاحيات
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.BOOKING_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') // current, past, upcoming
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const now = new Date()
  let dateFilter: any = {}

  if (status === 'current') {
    dateFilter = {
      checkInDate: { lte: now },
      checkOutDate: { gte: now },
      status: 'CHECKED_IN'
    }
  } else if (status === 'past') {
    dateFilter = {
      checkOutDate: { lt: now }
    }
  } else if (status === 'upcoming') {
    dateFilter = {
      checkInDate: { gt: now },
      status: { in: ['PENDING', 'CONFIRMED'] }
    }
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: {
        hotelId: id,
        ...dateFilter
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatar: true,
          }
        },
        room: {
          select: {
            id: true,
            number: true,
            type: true,
            floor: true,
          }
        },
        guestDetails: true,
      },
      orderBy: { checkIn: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({
      where: { hotelId: id, ...dateFilter }
    })
  ])

  // تنسيق بيانات النزلاء
  const guests = bookings.map(booking => ({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    guest: {
      ...booking.user,
      ...(booking.guestDetails && {
        nationality: booking.guestDetails.nationality,
        idType: booking.guestDetails.idType,
        idNumber: booking.guestDetails.idNumber,
        specialNeeds: booking.guestDetails.specialNeeds,
      })
    },
    room: booking.room,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status: booking.status,
    guests: booking.guests,
    totalPrice: booking.totalPrice,
  }))

  return successResponse({
    hotelCode: hotel.hotelCode,
    guests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/hotels/[id]/guests' })
