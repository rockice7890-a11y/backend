import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem, conflictResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { hotelSchema } from '@/utils/validation'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على فندق محدد مع كل البيانات المرتبطة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const includeStats = searchParams.get('includeStats') === 'true'

  const hotel = await prisma.hotel.findUnique({
    where: { id },
    include: {
      manager: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
        },
      },
      rooms: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      },
      features: {
        include: {
          feature: true,
        },
      },
      services: {
        where: { isActive: true },
      },
      _count: {
        select: {
          rooms: true,
          bookings: true,
          reviews: true,
          services: true,
        },
      },
    },
  })

  if (!hotel) {
    return notFoundResponse('الفندق')
  }

  // إحصائيات إضافية إذا طُلبت
  let stats = null
  if (includeStats) {
    const [
      totalBookings,
      activeBookings,
      completedBookings,
      cancelledBookings,
      totalRevenue,
      avgRating,
      occupancyData
    ] = await Promise.all([
      // إجمالي الحجوزات
      prisma.booking.count({ where: { hotelId: id } }),
      // الحجوزات النشطة
      prisma.booking.count({
        where: { hotelId: id, status: { in: ['CONFIRMED', 'CHECKED_IN'] } }
      }),
      // الحجوزات المكتملة
      prisma.booking.count({
        where: { hotelId: id, status: 'COMPLETED' }
      }),
      // الحجوزات الملغية
      prisma.booking.count({
        where: { hotelId: id, status: 'CANCELLED' }
      }),
      // إجمالي الإيرادات
      prisma.booking.aggregate({
        where: { hotelId: id, paymentStatus: 'PAID' },
        _sum: { totalPrice: true }
      }),
      // متوسط التقييم
      prisma.review.aggregate({
        where: { hotelId: id },
        _avg: { rating: true }
      }),
      // نسبة الإشغال (الغرف المشغولة حالياً)
      prisma.room.count({
        where: { hotelId: id, status: 'OCCUPIED' }
      })
    ])

    const totalRooms = hotel._count.rooms
    const occupancyRate = totalRooms > 0
      ? Math.round((occupancyData / totalRooms) * 100)
      : 0

    stats = {
      bookings: {
        total: totalBookings,
        active: activeBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
      },
      revenue: {
        total: totalRevenue._sum.totalPrice || 0,
        currency: 'USD'
      },
      rating: {
        average: avgRating._avg.rating || 0,
        totalReviews: hotel._count.reviews
      },
      occupancy: {
        rate: occupancyRate,
        occupiedRooms: occupancyData,
        totalRooms: totalRooms
      }
    }
  }

  return successResponse({
    hotel,
    ...(stats && { stats })
  })
}

// تحديث فندق
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const hotel = await prisma.hotel.findUnique({
    where: { id },
  })

  if (!hotel) {
    return notFoundResponse('الفندق')
  }

  // التحقق من الصلاحيات
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذا الفندق')
  }

  const body = await request.json()
  const validatedData = hotelSchema.partial().parse(body)

  // منع تغيير hotelCode
  delete (validatedData as any).hotelCode

  const updatedHotel = await prisma.hotel.update({
    where: { id },
    data: validatedData,
    include: {
      manager: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'HOTEL_UPDATED' as AuditAction,
    resource: 'hotel',
    resourceId: id,
    details: { changes: Object.keys(validatedData) },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ hotel: updatedHotel }, { message: 'تم تحديث الفندق بنجاح' })
}

// حذف فندق
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.HOTEL_DELETE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف الفندق')
  }

  // التحقق من وجود حجوزات نشطة
  const activeBookings = await prisma.booking.count({
    where: {
      hotelId: id,
      status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }
    }
  })

  if (activeBookings > 0) {
    return conflictResponse(`لا يمكن حذف الفندق، يوجد ${activeBookings} حجوزات نشطة`)
  }

  const deletedHotel = await prisma.hotel.delete({
    where: { id },
    select: {
      id: true,
      hotelCode: true,
      name: true,
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'HOTEL_DELETED' as AuditAction,
    resource: 'hotel',
    resourceId: id,
    details: deletedHotel,
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({
    hotel: deletedHotel
  }, { message: 'تم حذف الفندق بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/hotels/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/hotels/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/hotels/[id]' })
