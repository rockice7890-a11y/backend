import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, createdResponse, validationProblem, conflictResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// التحقق من بيانات التقييم
const feedbackSchema = z.object({
  bookingId: z.string().min(1, 'معرف الحجز مطلوب'),
  rating: z.number().int().min(1).max(5, 'التقييم يجب أن يكون بين 1 و 5'),
  category: z.enum(['room', 'service', 'cleanliness', 'location', 'value', 'overall'], {
    errorMap: () => ({ message: 'فئة غير صالحة' })
  }),
  comment: z.string().optional(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
})

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const isAdmin = authorize(user, PermissionType.REVIEW_MANAGE) ||
    ['ADMIN', 'HOTEL_MANAGER', 'SUPER_ADMIN'].includes(user.role)

  // المستخدمون العاديون يمكنهم رؤية تقييماتهم فقط
  const where: any = isAdmin ? {} : { userId: user.userId }

  const [feedbacks, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        booking: {
          select: {
            id: true,
            checkIn: true,
            checkOut: true,
            hotel: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    }),
    prisma.feedback.count({ where })
  ])

  // حساب متوسط التقييمات للمستخدم
  let userStats = null
  if (!isAdmin) {
    const userFeedbacks = await prisma.feedback.findMany({
      where: { userId: user.userId }
    })
    const totalFeedbacks = userFeedbacks.length
    const averageRating = totalFeedbacks > 0
      ? userFeedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / totalFeedbacks
      : 0

    userStats = {
      total: totalFeedbacks,
      averageRating: Math.round(averageRating * 10) / 10
    }
  }

  return paginatedResponse(feedbacks, total, page, limit, {
    message: 'تم جلب التقييمات بنجاح',
    userStats
  })
}

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.REVIEW_CREATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإرسال تقييم')
  }

  const body = await request.json()
  const validatedData = feedbackSchema.parse(body)

  // التحقق من الحجز
  const booking = await prisma.booking.findFirst({
    where: {
      id: validatedData.bookingId,
      userId: user.userId,
      status: 'COMPLETED' // يمكن التقييم فقط بعد الإنتهاء
    },
    include: {
      hotel: {
        select: {
          id: true,
          name: true
        }
      }
    }
  })

  if (!booking) {
    return notFoundResponse('الحجز غير موجود أو غير مكتمل')
  }

  // التحقق من عدم وجود تقييم مسبق
  const existingFeedback = await prisma.feedback.findFirst({
    where: { bookingId: validatedData.bookingId }
  })

  if (existingFeedback) {
    return conflictResponse('تم إرسال تقييم لهذا الحجز مسبقاً')
  }

  // إنشاء التقييم
  const feedback = await prisma.feedback.create({
    data: {
      userId: user.userId,
      bookingId: validatedData.bookingId,
      rating: validatedData.rating,
      category: validatedData.category,
      comment: validatedData.comment,
      pros: validatedData.pros || [],
      cons: validatedData.cons || [],
      isPublic: true
    }
  })

  // تحديث متوسط تقييم الفندق
  await updateHotelRating(booking.hotelId)

  // تسجيل التقييم
  await createAuditLog({
    userId: user.userId,
    action: 'FEEDBACK_SUBMITTED' as AuditAction,
    resource: 'feedback',
    resourceId: feedback.id,
    details: {
      rating: validatedData.rating,
      category: validatedData.category,
      bookingId: validatedData.bookingId,
      hotelName: booking.hotel?.name
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({
    feedbackId: feedback.id,
    message: 'شكراً لتقييمك!'
  }, { message: 'تم إرسال التقييم بنجاح' })
}

// تحديث متوسط تقييم الفندق
async function updateHotelRating(hotelId: string) {
  const result = await prisma.feedback.aggregate({
    where: {
      booking: {
        hotelId: hotelId
      }
    },
    _avg: { rating: true },
    _count: { rating: true }
  })

  await prisma.hotel.update({
    where: { id: hotelId },
    data: {
      rating: result._avg.rating || 0,
      totalReviews: result._count.rating || 0
    }
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/feedback' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/feedback' })
