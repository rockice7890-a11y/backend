import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.BOOKING_READ)) {
    return forbiddenResponse('ليس لديك صلاحية لعرض الحجوزات')
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // البحث عن الحجوزات التي يجب أن يتم الخروج منها اليوم
  const pendingCheckouts = await prisma.booking.findMany({
    where: {
      status: 'CHECKED_IN',
      checkOut: {
        lte: new Date(today.getTime() + 24 * 60 * 60 * 1000), // اليوم أو قبل
      },
    },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
          checkOutTime: true,
        },
      },
      room: {
        select: {
          id: true,
          number: true,
          type: true,
        },
      },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: { checkOut: 'asc' },
  })

  return successResponse({
    pendingCheckouts,
    count: pendingCheckouts.length
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/auto-checkout/pending' })
