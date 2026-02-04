import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { Permissions, PermissionType } from '@/utils/permissions'
import { featureSchema } from '@/utils/validation'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على ميزة محددة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const feature = await prisma.feature.findUnique({
    where: { id },
    include: {
      hotels: {
        include: {
          hotel: {
            select: {
              id: true,
              name: true,
              city: true,
              address: true,
            },
          },
        },
      },
      _count: {
        select: {
          hotels: true,
        },
      },
    },
  })

  if (!feature) {
    return errorResponse('NOT_FOUND', 'الميزة غير موجودة', { status: 404 })
  }

  return successResponse({ feature })
}

// تحديث ميزة
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.FEATURE_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لتحديث الميزة', { status: 403 })
  }

  const body = await request.json()
  const validatedData = featureSchema.partial().parse(body)

  const updatedFeature = await prisma.feature.update({
    where: { id },
    data: validatedData,
  })

  return successResponse({ feature: updatedFeature })
}

// حذف ميزة
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.FEATURE_DELETE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لحذف الميزة', { status: 403 })
  }

  const deletedFeature = await prisma.feature.delete({
    where: { id },
    select: {
      id: true,
      name: true,
    },
  })

  return successResponse({
    message: 'تم حذف الميزة بنجاح',
    feature: deletedFeature
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/features/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/features/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/features/[id]' })
