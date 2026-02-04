import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { z } from 'zod'
import { successResponse, errorResponse, createdResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const loyaltyTransactionSchema = z.object({
  points: z.number().int(),
  type: z.enum(['earn', 'redeem', 'expire']),
  description: z.string().optional(),
  bookingId: z.string().optional(),
})

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId') || user.userId

  // المستخدم العادي يمكنه رؤية نقاطه فقط
  if ((user.role === 'USER' || user.role === 'GUEST') && userId !== user.userId) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لعرض نقاط مستخدم آخر', { status: 403 })
  }

  let loyaltyPoint = await prisma.loyaltyPoint.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  // إنشاء سجل نقاط الولاء إذا لم يكن موجوداً
  if (!loyaltyPoint) {
    loyaltyPoint = await prisma.loyaltyPoint.create({
      data: {
        userId,
        points: 0,
        tier: 'BRONZE',
      },
      include: {
        transactions: true,
      },
    })
  }

  return successResponse({ loyaltyPoint })
}

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const body = await request.json()
  const validatedData = loyaltyTransactionSchema.parse(body)

  // التحقق من الصلاحيات
  if (validatedData.type === 'earn' && !authorize(user, PermissionType.LOYALTY_MANAGE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لإضافة نقاط', { status: 403 })
  }

  // الحصول على أو إنشاء سجل نقاط الولاء
  let loyaltyPoint = await prisma.loyaltyPoint.findUnique({
    where: { userId: user.userId },
  })

  if (!loyaltyPoint) {
    loyaltyPoint = await prisma.loyaltyPoint.create({
      data: {
        userId: user.userId,
        points: 0,
        tier: 'BRONZE',
      },
    })
  }

  // حساب النقاط الجديدة
  let newPoints = loyaltyPoint.points
  if (validatedData.type === 'earn') {
    newPoints += validatedData.points
  } else if (validatedData.type === 'redeem') {
    if (loyaltyPoint.points < validatedData.points) {
      return errorResponse('BAD_REQUEST', 'نقاطك غير كافية', { status: 400 })
    }
    newPoints -= validatedData.points
  } else if (validatedData.type === 'expire') {
    newPoints = Math.max(0, newPoints - validatedData.points)
  }

  // تحديث المستوى
  let newTier = 'BRONZE'
  if (newPoints >= 10000) newTier = 'PLATINUM'
  else if (newPoints >= 5000) newTier = 'GOLD'
  else if (newPoints >= 1000) newTier = 'SILVER'

  // تحديث نقاط الولاء
  const updatedLoyaltyPoint = await prisma.loyaltyPoint.update({
    where: { id: loyaltyPoint.id },
    data: {
      points: newPoints,
      tier: newTier,
    },
  })

  // إنشاء معاملة
  const transaction = await prisma.loyaltyTransaction.create({
    data: {
      userId: user.userId,
      loyaltyPointId: updatedLoyaltyPoint.id,
      points: validatedData.type === 'earn' ? validatedData.points : -validatedData.points,
      type: validatedData.type,
      description: validatedData.description,
      bookingId: validatedData.bookingId,
    },
  })

  return createdResponse({
    loyaltyPoint: updatedLoyaltyPoint,
    transaction
  }, { message: 'تمت معالجة نقاط الولاء بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/loyalty/points' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/loyalty/points' })
