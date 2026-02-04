import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, createdResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.LOYALTY_MANAGE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لعرض المفضلة', { status: 403 })
  }

  const wishlist = await prisma.wishlist.findMany({
    where: { userId: user.userId },
    include: {
      hotel: {
        include: {
          manager: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              reviews: true,
              rooms: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ wishlist })
}

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.LOYALTY_MANAGE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لإدارة المفضلة', { status: 403 })
  }

  const body = await request.json()
  const { hotelId } = body

  if (!hotelId) {
    return errorResponse('BAD_REQUEST', 'معرف الفندق مطلوب', { status: 400 })
  }

  // التحقق من وجود الفندق
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  // التحقق من عدم وجود الفندق في المفضلة بالفعل
  const existingWishlist = await prisma.wishlist.findUnique({
    where: {
      userId_hotelId: {
        userId: user.userId,
        hotelId,
      },
    },
  })

  if (existingWishlist) {
    return errorResponse('CONFLICT', 'الفندق موجود بالفعل في المفضلة', { status: 400 })
  }

  const wishlistItem = await prisma.wishlist.create({
    data: {
      userId: user.userId,
      hotelId,
    },
    include: {
      hotel: {
        include: {
          manager: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              reviews: true,
              rooms: true,
            },
          },
        },
      },
    },
  })

  return createdResponse({ wishlist: wishlistItem })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/wishlist' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/wishlist' })
