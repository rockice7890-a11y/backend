import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { Permissions, PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// إحصائيات شاملة للفندق
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const hotel = await prisma.hotel.findUnique({
    where: { id },
    select: { id: true, managerId: true, hotelCode: true, name: true }
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_FINANCIAL_REPORTS)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || 'month' // day, week, month, year

  const now = new Date()
  let startDate = new Date()

  switch (period) {
    case 'day':
      startDate.setHours(0, 0, 0, 0)
      break
    case 'week':
      startDate.setDate(now.getDate() - 7)
      break
    case 'month':
      startDate.setMonth(now.getMonth() - 1)
      break
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1)
      break
  }

  const [
    // إحصائيات الحجوزات
    totalBookings,
    newBookings,
    bookingsByStatus,
    // إحصائيات الغرف
    totalRooms,
    roomsByStatus,
    // الإيرادات
    revenue,
    // التقييمات
    reviews,
    // النزلاء الحاليين
    currentGuests,
  ] = await Promise.all([
    // إجمالي الحجوزات
    prisma.booking.count({ where: { hotelId: id } }),
    // الحجوزات الجديدة في الفترة
    prisma.booking.count({
      where: { hotelId: id, createdAt: { gte: startDate } }
    }),
    // الحجوزات حسب الحالة
    prisma.booking.groupBy({
      by: ['status'],
      where: { hotelId: id },
      _count: true
    }),
    // إجمالي الغرف
    prisma.room.count({ where: { hotelId: id } }),
    // الغرف حسب الحالة
    prisma.room.groupBy({
      by: ['status'],
      where: { hotelId: id },
      _count: true
    }),
    // الإيرادات
    prisma.booking.aggregate({
      where: {
        hotelId: id,
        paymentStatus: 'PAID',
        createdAt: { gte: startDate }
      },
      _sum: { totalPrice: true },
      _count: true
    }),
    // التقييمات
    prisma.review.aggregate({
      where: { hotelId: id },
      _avg: { rating: true },
      _count: true
    }),
    // النزلاء الحاليين
    prisma.booking.count({
      where: { hotelId: id, status: 'CHECKED_IN' }
    })
  ])

  // حساب نسبة الإشغال
  const occupiedRooms = roomsByStatus.find(r => r.status === 'OCCUPIED')?._count || 0
  const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0

  // تنسيق حالات الحجوزات
  const bookingsStatusMap: Record<string, number> = {}
  bookingsByStatus.forEach(item => {
    bookingsStatusMap[item.status] = item._count
  })

  // تنسيق حالات الغرف
  const roomsStatusMap: Record<string, number> = {}
  roomsByStatus.forEach(item => {
    roomsStatusMap[item.status] = item._count
  })

  return successResponse({
    hotel: {
      id: hotel.id,
      hotelCode: hotel.hotelCode,
      name: hotel.name
    },
    period,
    stats: {
      bookings: {
        total: totalBookings,
        new: newBookings,
        byStatus: bookingsStatusMap
      },
      rooms: {
        total: totalRooms,
        byStatus: roomsStatusMap,
        occupancyRate: `${occupancyRate}%`
      },
      guests: {
        current: currentGuests
      },
      revenue: {
        total: revenue._sum.totalPrice || 0,
        transactions: revenue._count,
        currency: 'USD'
      },
      reviews: {
        averageRating: Math.round((reviews._avg.rating || 0) * 10) / 10,
        totalReviews: reviews._count
      }
    }
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/hotels/[id]/stats' })
