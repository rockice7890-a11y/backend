import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, createdResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem, conflictResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

const reviewSchema = z.object({
  hotelId: z.string().min(1, 'معرف الفندق مطلوب'),
  bookingId: z.string().optional(),
  rating: z.number().int().min(1).max(5, 'التقييم يجب أن يكون بين 1 و 5'),
  comment: z.string().optional(),
})

const reviewUpdateSchema = z.object({
  rating: z.number().int().min(1).max(5, 'التقييم يجب أن يكون بين 1 و 5').optional(),
  comment: z.string().optional(),
  isVerified: z.boolean().optional(),
}).refine(data => data.rating !== undefined || data.comment !== undefined || data.isVerified !== undefined, {
  message: 'يجب توفير حقل واحد على الأقل للتحديث',
  path: ['rating', 'comment', 'isVerified'],
});

// الحصول على جميع التقييمات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // التحقق من الصلاحية - المستخدمون العاديون يمكنهم رؤية تقييماتهم فقط
  const isAdmin = authorize(user, PermissionType.REVIEW_MANAGE) ||
    ['ADMIN', 'HOTEL_MANAGER', 'SUPER_ADMIN'].includes(user.role);

  const { searchParams } = new URL(request.url)
  const hotelId = searchParams.get('hotelId')
  const userId = searchParams.get('userId')
  const verified = searchParams.get('verified')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')

  const where: any = {}

  // المستخدمون العاديون يمكنهم رؤية تقييماتهم فقط
  if (!isAdmin) {
    where.userId = user.userId
  } else {
    if (userId) where.userId = userId
  }

  if (hotelId) where.hotelId = hotelId
  if (verified !== null) where.isVerified = verified === 'true'

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        hotel: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where })
  ])

  return paginatedResponse(reviews, total, page, limit, {
    message: 'تم جلب التقييمات بنجاح'
  })
}

// إنشاء تقييم جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.REVIEW_CREATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإنشاء تقييم')
  }

  const body = await request.json()
  const validatedData = reviewSchema.parse(body)

  // التحقق من وجود الفندق
  const hotel = await prisma.hotel.findUnique({
    where: { id: validatedData.hotelId },
  })

  if (!hotel) {
    return notFoundResponse('الفندق')
  }

  // التحقق من أن المستخدم لديه حجز في هذا الفندق (إذا تم توفير bookingId)
  if (validatedData.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: validatedData.bookingId },
    })

    if (!booking || booking.userId !== user.userId || booking.hotelId !== validatedData.hotelId) {
      return notFoundResponse('الحجز')
    }
  }

  // التحقق من عدم وجود تقييم سابق من نفس المستخدم لنفس الفندق
  const existingReview = await prisma.review.findFirst({
    where: {
      userId: user.userId,
      hotelId: validatedData.hotelId,
    },
  })

  if (existingReview) {
    return conflictResponse('لديك تقييم بالفعل لهذا الفندق')
  }

  const review = await prisma.review.create({
    data: {
      userId: user.userId,
      hotelId: validatedData.hotelId,
      bookingId: validatedData.bookingId,
      rating: validatedData.rating,
      comment: validatedData.comment,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
        },
      },
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
    },
  })

  // تحديث تقييم الفندق
  const hotelReviews = await prisma.review.findMany({
    where: { hotelId: validatedData.hotelId },
    select: { rating: true },
  })

  const avgRating = hotelReviews.reduce((sum, r) => sum + r.rating, 0) / hotelReviews.length

  await prisma.hotel.update({
    where: { id: validatedData.hotelId },
    data: {
      rating: avgRating,
      totalReviews: hotelReviews.length,
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'REVIEW_CREATED',
    resource: 'review',
    resourceId: review.id,
    details: { hotelId: validatedData.hotelId, rating: validatedData.rating },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  })

  return createdResponse({ review }, {
    message: 'تم إنشاء التقييم بنجاح'
  })
}

// تحديث تقييم موجود
const handlePut = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const reviewId = searchParams.get('id')

  if (!reviewId) {
    return errorResponse('BAD_REQUEST', 'معرف التقييم مطلوب')
  }

  const body = await request.json()
  const validatedData = reviewUpdateSchema.parse(body)

  const reviewToUpdate = await prisma.review.findUnique({
    where: { id: reviewId },
  })

  if (!reviewToUpdate) {
    return notFoundResponse('التقييم')
  }

  // التحقق من الصلاحية: يمكن للمستخدم تحديث تقييمه الخاص أو المسؤول يمكنه تحديث أي تقييم
  if (reviewToUpdate.userId !== user.userId && !authorize(user, PermissionType.REVIEW_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذا التقييم')
  }

  // إذا كان المستخدم ليس مسؤولاً، فلا يمكنه تغيير حقل isVerified
  if (validatedData.isVerified !== undefined && !authorize(user, PermissionType.REVIEW_MANAGE)) {
    return forbiddenResponse('ليس لديك صلاحية لتغيير حالة التحقق للتقييم')
  }

  const updatedReview = await prisma.review.update({
    where: { id: reviewId },
    data: {
      rating: validatedData.rating,
      comment: validatedData.comment,
      isVerified: validatedData.isVerified,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
        },
      },
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
    },
  })

  // تحديث تقييم الفندق إذا تم تغيير التقييم
  if (validatedData.rating !== undefined) {
    const hotelReviews = await prisma.review.findMany({
      where: { hotelId: updatedReview.hotelId },
      select: { rating: true },
    })

    const avgRating = hotelReviews.reduce((sum, r) => sum + r.rating, 0) / hotelReviews.length

    await prisma.hotel.update({
      where: { id: updatedReview.hotelId },
      data: {
        rating: avgRating,
        totalReviews: hotelReviews.length,
      },
    })
  }

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'REVIEW_UPDATED',
    resource: 'review',
    resourceId: updatedReview.id,
    details: { original: reviewToUpdate, updated: validatedData },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  })

  return successResponse({ review: updatedReview }, {
    message: 'تم تحديث التقييم بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/reviews' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/reviews' })
export const PUT = withErrorHandler(handlePut, { method: 'PUT', path: '/api/reviews' })
