import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على مميزات فندق
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const hotel = await prisma.hotel.findUnique({
    where: { id },
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  const hotelFeatures = await prisma.hotelFeature.findMany({
    where: { hotelId: id },
    include: {
      feature: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return successResponse({
    features: hotelFeatures.map(hf => hf.feature),
    hotelId: id
  })
}

// إضافة ميزة إلى فندق
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const hotel = await prisma.hotel.findUnique({
    where: { id },
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  // التحقق من الصلاحيات
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لإضافة مميزات لهذا الفندق', { status: 403 })
  }

  const body = await request.json()
  const { featureId } = body

  if (!featureId) {
    return errorResponse('BAD_REQUEST', 'معرف الميزة مطلوب', { status: 400 })
  }

  // التحقق من وجود الميزة
  const feature = await prisma.feature.findUnique({
    where: { id: featureId },
  })

  if (!feature) {
    return errorResponse('NOT_FOUND', 'الميزة غير موجودة', { status: 404 })
  }

  // التحقق من عدم تكرار الميزة
  const existingHotelFeature = await prisma.hotelFeature.findUnique({
    where: {
      hotelId_featureId: {
        hotelId: id,
        featureId,
      },
    },
  })

  if (existingHotelFeature) {
    return errorResponse('BAD_REQUEST', 'الميزة موجودة بالفعل في هذا الفندق', { status: 400 })
  }

  const hotelFeature = await prisma.hotelFeature.create({
    data: {
      hotelId: id,
      featureId,
    },
    include: {
      feature: true,
    },
  })

  return createdResponse({ hotelFeature })
}

// حذف ميزة من فندق
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const hotel = await prisma.hotel.findUnique({
    where: { id },
  })

  if (!hotel) {
    return errorResponse('NOT_FOUND', 'الفندق غير موجود', { status: 404 })
  }

  // التحقق من الصلاحيات
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية لحذف مميزات من هذا الفندق', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const featureId = searchParams.get('featureId')

  if (!featureId) {
    return errorResponse('BAD_REQUEST', 'معرف الميزة مطلوب', { status: 400 })
  }

  await prisma.hotelFeature.delete({
    where: {
      hotelId_featureId: {
        hotelId: id,
        featureId,
      },
    },
  })

  return successResponse({
    message: 'تم حذف الميزة من الفندق بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/hotels/[id]/features' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/hotels/[id]/features' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/hotels/[id]/features' })
