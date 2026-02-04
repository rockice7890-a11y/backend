import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ hotelId: string }> }
): Promise<NextResponse> => {
  const { hotelId } = await params
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.LOYALTY_MANAGE)) {
    return forbiddenResponse('ليس لديك صلاحية لإدارة المفضلة')
  }

  const wishlistItem = await prisma.wishlist.findUnique({
    where: {
      userId_hotelId: {
        userId: user.userId,
        hotelId: hotelId,
      },
    },
  })

  if (!wishlistItem) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود في المفضلة', { status: 404 })
  }

  await prisma.wishlist.delete({
    where: {
      userId_hotelId: {
        userId: user.userId,
        hotelId: hotelId,
      },
    },
  })

  return successResponse({ message: 'تم حذف الفندق من المفضلة بنجاح' })
}

export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/wishlist/[hotelId]' })
