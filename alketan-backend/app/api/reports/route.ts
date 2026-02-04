import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorize } from '@/middleware/auth';
import { PermissionType } from '@/utils/permissions';
import { successResponse, errorResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse } from '@/utils/apiResponse';
import { createAuditLog, detectSuspiciousActivity } from '@/utils/auditLogger';
import { subMonths, startOfMonth, format } from 'date-fns';
import { withErrorHandler } from '@/utils/errorHandler';

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح لك');
  }

  // التحقق من الصلاحيات
  const hasPermission = authorize(user, PermissionType.REPORTS_VIEW) ||
    ['HOTEL_MANAGER', 'ACCOUNTANT', 'ADMIN'].includes(user.role) ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '');

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لعرض التقارير');
  }

  const { searchParams } = new URL(request.url);
  const hotelId = searchParams.get('hotelId');
  const type = searchParams.get('type') || 'overview';
  const period = searchParams.get('period') || 'month';
  const startDateParam = searchParams.get('startDate');
  const endDateParam = searchParams.get('endDate');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');

  let startDate: Date;
  let endDate: Date = new Date();

  // تحديد الفترة
  if (startDateParam && endDateParam) {
    startDate = new Date(startDateParam);
    endDate = new Date(endDateParam);
  } else {
    switch (period) {
      case 'today':
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        break;
      case 'week':
        startDate = subMonths(new Date(), 1);
        break;
      case 'month':
        startDate = startOfMonth(subMonths(new Date(), 0));
        endDate = new Date();
        break;
      case 'year':
        startDate = subMonths(new Date(), 12);
        break;
      default:
        startDate = startOfMonth(subMonths(new Date(), 0));
        endDate = new Date();
    }
  }

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = startDate;
  if (endDate) dateFilter.lte = endDate;

  const where: any = {};
  if (hotelId) where.hotelId = hotelId;
  if (startDate || endDate) where.createdAt = dateFilter;

  // تسجيل طلب التقرير
  await createAuditLog({
    userId: user.userId,
    action: 'REPORT_GENERATED',
    resource: 'report',
    details: { type, hotelId, period, startDate, endDate },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  if (type === 'revenue') {
    // تقرير الإيرادات
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: { ...where, paymentStatus: 'PAID' },
        select: { totalPrice: true, createdAt: true, hotelId: true },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where: { ...where, paymentStatus: 'PAID' } })
    ]);

    const totalRevenue = bookings.reduce((sum, b) => sum + b.totalPrice, 0);
    const avgBookingValue = bookings.length > 0 ? totalRevenue / bookings.length : 0;

    return successResponse({
      type: 'revenue',
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      },
      totalRevenue,
      totalBookings: bookings.length,
      avgBookingValue,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  }

  if (type === 'occupancy') {
    // تقرير الإشغال
    const [rooms, occupiedRooms, roomStats] = await Promise.all([
      prisma.room.count({ where: hotelId ? { hotelId } : {} }),
      prisma.room.count({ where: { ...(hotelId ? { hotelId } : {}), status: 'OCCUPIED' } }),
      prisma.room.groupBy({
        by: ['status'],
        where: hotelId ? { hotelId } : {},
        _count: true
      })
    ]);

    const occupancyRate = rooms > 0 ? (occupiedRooms / rooms) * 100 : 0;

    return successResponse({
      type: 'occupancy',
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      summary: {
        totalRooms: rooms,
        occupiedRooms,
        availableRooms: rooms - occupiedRooms,
        occupancyRate: Math.round(occupancyRate * 100) / 100
      },
      roomBreakdown: roomStats.map(r => ({
        status: r.status,
        count: r._count
      }))
    });
  }

  if (type === 'bookings') {
    // تقرير الحجوزات
    const statuses = ['PENDING', 'APPROVED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'];
    const bookingStats: any = {};

    for (const status of statuses) {
      bookingStats[status] = await prisma.booking.count({
        where: { ...where, status: status as any },
      });
    }

    return successResponse({
      type: 'bookings',
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      summary: {
        ...bookingStats,
        total: Object.values(bookingStats).reduce((a: number, b: any) => a + b, 0),
      }
    });
  }

  if (type === 'financial') {
    // تقرير مالي شامل
    const [
      payments,
      bookings,
      refunds,
      revenueByRoom,
      paymentMethods,
      monthlyComparison
    ] = await Promise.all([
      // جميع المدفوعات
      prisma.payment.findMany({
        where: {
          status: 'COMPLETED',
          createdAt: dateFilter
        },
        include: {
          booking: {
            select: {
              id: true,
              room: { select: { number: true, type: true } }
            }
          }
        }
      }),

      // ملخص الحجوزات
      prisma.booking.groupBy({
        by: ['status'],
        where: { createdAt: dateFilter },
        _count: true
      }),

      // المبالغ المستردة (من عمليات الدفع التي تم استردادها)
      prisma.payment.aggregate({
        where: {
          status: 'REFUNDED',
          updatedAt: dateFilter
        },
        _sum: { amount: true },
        _count: true
      }),

      // الإيرادات حسب الغرفة
      prisma.booking.groupBy({
        by: ['roomId'],
        where: {
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          createdAt: dateFilter
        },
        _sum: { totalPrice: true },
        _count: true
      }),

      // المدفوعات حسب الطريقة
      prisma.payment.groupBy({
        by: ['method'],
        where: {
          status: 'COMPLETED',
          createdAt: dateFilter
        },
        _sum: { amount: true },
        _count: true
      }),

      // مقارنة الأشهر
      prisma.$queryRaw`
        SELECT 
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
          SUM(amount) as revenue,
          COUNT(*) as bookings
        FROM payments
        WHERE status = 'COMPLETED'
          AND created_at >= ${subMonths(startDate, 12)}
          AND created_at <= ${endDate}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month ASC
      ` as Promise<Array<{ month: string; revenue: number; bookings: number }>>
    ]);

    // حساب الإجماليات
    const totalRevenue = payments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const totalBookings = bookings.reduce((sum: number, b: any) => sum + b._count, 0);
    const totalRefunds = (refunds as any)._sum?.amount || 0;
    const netRevenue = totalRevenue - totalRefunds;
    const averageBookingValue = totalBookings > 0 ? netRevenue / totalBookings : 0;

    // الإيرادات حسب الغرفة
    const revenueByRoomDetailed = await Promise.all(
      revenueByRoom
        .filter(r => r.roomId)
        .sort((a, b) => (Number(b._sum.totalPrice) || 0) - (Number(a._sum.totalPrice) || 0))
        .slice(0, 10)
        .map(async r => {
          const room = await prisma.room.findUnique({
            where: { id: (r as any).roomId! },
            select: { number: true, type: true }
          });
          return {
            roomId: (r as any).roomId,
            roomNumber: room?.number,
            type: room?.type,
            revenue: Number((r as any)._sum.totalPrice) || 0,
            bookingsCount: (r as any)._count
          };
        })
    );

    return successResponse({
      type: 'financial',
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
      },
      summary: {
        totalRevenue,
        totalRefunds,
        netRevenue,
        totalBookings,
        cancelledBookings: bookings.find(b => b.status === 'CANCELLED')?._count || 0,
        averageBookingValue: Math.round(averageBookingValue * 100) / 100,
        totalPayments: payments.length,
        totalRefundsCount: refunds._count
      },
      revenueByRoom: revenueByRoomDetailed,
      paymentMethods: paymentMethods.map(p => ({
        method: p.method,
        amount: Number(p._sum.amount) || 0,
        count: p._count
      })),
      monthlyComparison: monthlyComparison.map(m => ({
        month: m.month,
        revenue: Number(m.revenue),
        bookings: Number(m.bookings)
      }))
    });
  }

  if (type === 'security') {
    // تقرير الأمان - كشف الأنماط المشبوهة
    const logs = await prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      select: {
        action: true,
        ipAddress: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 1000
    });

    const analysis = detectSuspiciousActivity(logs);

    return successResponse({
      type: 'security',
      analysis,
      logsCount: logs.length,
      timestamp: new Date().toISOString()
    });
  }

  // overview - نظرة عامة
  const [totalBookings, totalRevenue, totalGuests, pendingBookings, roomStats] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.aggregate({ where: { ...where, paymentStatus: 'PAID' }, _sum: { totalPrice: true } }),
    prisma.guestDetails.count(),
    prisma.booking.count({ where: { ...where, status: 'PENDING' } }),
    prisma.room.groupBy({
      by: ['status'],
      where: hotelId ? { hotelId } : {},
      _count: true
    })
  ]);

  const totalRooms = roomStats.reduce((sum, r) => sum + r._count, 0);
  const occupiedRooms = roomStats.find(r => r.status === 'OCCUPIED')?._count || 0;

  return successResponse({
    type: 'overview',
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    summary: {
      totalBookings,
      totalRevenue: totalRevenue._sum.totalPrice || 0,
      totalGuests,
      pendingBookings,
      occupancyRate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0
    }
  });
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/reports' })
