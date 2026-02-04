import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') // نص البحث
  const city = searchParams.get('city')
  const country = searchParams.get('country')
  const minRating = searchParams.get('minRating')
  const maxPrice = searchParams.get('maxPrice')
  const checkIn = searchParams.get('checkIn')
  const checkOut = searchParams.get('checkOut')
  const guests = searchParams.get('guests')
  const amenities = searchParams.get('amenities')?.split(',')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const skip = (page - 1) * limit

  const where: any = {
    isActive: true,
  }

  // البحث النصي
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { nameAr: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      { descriptionAr: { contains: query, mode: 'insensitive' } },
      { city: { contains: query, mode: 'insensitive' } },
      { address: { contains: query, mode: 'insensitive' } },
    ]
  }

  // الفلترة حسب المدينة
  if (city) {
    where.city = { contains: city, mode: 'insensitive' }
  }

  // الفلترة حسب الدولة
  if (country) {
    where.country = { contains: country, mode: 'insensitive' }
  }

  // الفلترة حسب التقييم
  if (minRating) {
    where.rating = { gte: parseFloat(minRating) }
  }

  // الفلترة حسب المميزات
  if (amenities && amenities.length > 0) {
    where.amenities = { hasSome: amenities }
  }

  // البحث عن الفنادق
  const hotels = await prisma.hotel.findMany({
    where,
    include: {
      manager: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          rooms: true,
          reviews: true,
          bookings: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy: [
      { rating: 'desc' },
      { totalReviews: 'desc' },
    ],
  })

  // إذا تم تحديد تواريخ، فلتر الغرف المتاحة
  let availableHotels: any[] = hotels
  if (checkIn && checkOut && guests) {
    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)

    availableHotels = []
    for (const hotel of hotels) {
      const availableRooms = await prisma.room.findMany({
        where: {
          hotelId: hotel.id,
          isActive: true,
          capacity: { gte: parseInt(guests) },
          OR: [
            { status: 'AVAILABLE' },
            { status: 'RESERVED' },
          ],
        },
      })

      // التحقق من توفر الغرف في الفترة المحددة
      const roomsWithAvailability = []
      for (const room of availableRooms) {
        const conflictingBookings = await prisma.booking.findMany({
          where: {
            roomId: room.id,
            status: {
              in: ['CONFIRMED', 'CHECKED_IN'],
            },
            OR: [
              {
                AND: [
                  { checkIn: { lte: checkInDate } },
                  { checkOut: { gt: checkInDate } },
                ],
              },
              {
                AND: [
                  { checkIn: { lt: checkOutDate } },
                  { checkOut: { gte: checkOutDate } },
                ],
              },
              {
                AND: [
                  { checkIn: { gte: checkInDate } },
                  { checkOut: { lte: checkOutDate } },
                ],
              },
            ],
          },
        })

        if (conflictingBookings.length === 0) {
          roomsWithAvailability.push(room)
        }
      }

      if (roomsWithAvailability.length > 0) {
        availableHotels.push({
          ...hotel,
          availableRooms: roomsWithAvailability.length,
          minPrice: Math.min(...roomsWithAvailability.map(r => r.basePrice)),
        })
      }
    }
  }

  // الفلترة حسب السعر
  if (maxPrice) {
    availableHotels = availableHotels.filter(h =>
      !h.minPrice || h.minPrice <= parseFloat(maxPrice)
    )
  }

  const total = await prisma.hotel.count({ where })

  return successResponse({
    hotels: availableHotels,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/search/hotels' })
