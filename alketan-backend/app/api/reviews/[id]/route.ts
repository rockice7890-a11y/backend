import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على تقييم محدد
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const review = await prisma.review.findUnique({
    where: { id },
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
          address: true,
        },
      },
    },
  })

  if (!review) {
    return notFoundResponse('التقييم')
  }

  return successResponse({ review })
}

// تحديث تقييم
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const review = await prisma.review.findUnique({
    where: { id },
  })

  if (!review) {
    return notFoundResponse('التقييم')
  }

  // فقط صاحب التقييم يمكنه تحديثه
  if (review.userId !== user.userId && !authorize(user, PermissionType.REVIEW_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذا التقييم')
  }

  const body = await request.json()
  const updateData: any = {}
  if (body.rating !== undefined) updateData.rating = body.rating
  if (body.comment !== undefined) updateData.comment = body.comment

  const updatedReview = await prisma.review.update({
    where: { id },
    data: updateData,
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
    where: { hotelId: review.hotelId },
    select: { rating: true },
  })

  const avgRating = hotelReviews.reduce((sum, r) => sum + r.rating, 0) / hotelReviews.length

  await prisma.hotel.update({
    where: { id: review.hotelId },
    data: {
      rating: avgRating,
    },
  })

  return successResponse({ review: updatedReview })
}

// حذف تقييم
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const review = await prisma.review.findUnique({
    where: { id },
  })

  if (!review) {
    return notFoundResponse('التقييم')
  }

  // فقط صاحب التقييم أو المدير يمكنه حذفه
  if (review.userId !== user.userId && !authorize(user, PermissionType.REVIEW_DELETE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف هذا التقييم')
  }

  await prisma.review.delete({
    where: { id },
  })

  // تحديث تقييم الفندق
  const hotelReviews = await prisma.review.findMany({
    where: { hotelId: review.hotelId },
    select: { rating: true },
  })

  if (hotelReviews.length > 0) {
    const avgRating = hotelReviews.reduce((sum, r) => sum + r.rating, 0) / hotelReviews.length
    await prisma.hotel.update({
      where: { id: review.hotelId },
      data: {
        rating: avgRating,
        totalReviews: hotelReviews.length,
      },
    })
  } else {
    await prisma.hotel.update({
      where: { id: review.hotelId },
      data: {
        rating: 0,
        totalReviews: 0,
      },
    })
  }

  return successResponse({ message: 'تم حذف التقييم بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/reviews/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/reviews/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/reviews/[id]' })
