import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { featureSchema } from '@/utils/validation'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, createdResponse, validationProblem } from '@/utils/apiResponse';
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على جميع المميزات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const isActive = searchParams.get('isActive')
  const hotelId = searchParams.get('hotelId') // للحصول على مميزات فندق محدد

  if (hotelId) {
    // الحصول على مميزات فندق محدد
    const hotelFeatures = await prisma.hotelFeature.findMany({
      where: {
        hotelId,
        feature: {
          isActive: isActive === null ? undefined : isActive === 'true',
          category: (category as any) || undefined,
        },
      },
      include: {
        feature: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return successResponse({
      features: hotelFeatures.map(hf => hf.feature),
      hotelId
    })
  }

  // الحصول على جميع المميزات
  const where: any = {}
  if (category) where.category = category
  if (isActive !== null) where.isActive = isActive === 'true'

  const features = await prisma.feature.findMany({
    where,
    include: {
      _count: {
        select: {
          hotels: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ features })
}

// إنشاء ميزة جديدة
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.FEATURE_CREATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإنشاء ميزة')
  }

  const body = await request.json()
  const validatedResult = featureSchema.safeParse(body)

  if (!validatedResult.success) {
    return validationProblem(validatedResult.error.errors.map((e: any) => ({
      field: e.path.join('.'),
      message: e.message
    })))
  }

  const feature = await prisma.feature.create({
    data: validatedResult.data,
  })

  return createdResponse({ feature }, { message: 'تم إنشاء الميزة بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/features' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/features' })
