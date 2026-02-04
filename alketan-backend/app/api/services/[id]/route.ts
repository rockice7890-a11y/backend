import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على خدمة محددة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
          address: true,
        },
      },
      _count: {
        select: {
          bookings: true,
        },
      },
    },
  })

  if (!service) {
    return notFoundResponse('الخدمة')
  }

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'SERVICE_READ' as AuditAction,
    resource: 'service',
    resourceId: id,
    details: { action: 'view_single' },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ service })
}

// تحديث خدمة
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث الخدمة')
  }

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      hotel: true,
    },
  })

  if (!service) {
    return notFoundResponse('الخدمة')
  }

  // التحقق من الصلاحيات
  if (service.hotel.managerId !== user.userId && !authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذه الخدمة')
  }

  const body = await request.json()
  const updateData: any = {}
  if (body.name !== undefined) updateData.name = body.name
  if (body.nameAr !== undefined) updateData.nameAr = body.nameAr
  if (body.description !== undefined) updateData.description = body.description
  if (body.price !== undefined) updateData.price = body.price
  if (body.category !== undefined) updateData.category = body.category
  if (body.isActive !== undefined) updateData.isActive = body.isActive

  const updatedService = await prisma.service.update({
    where: { id },
    data: updateData,
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
        },
      },
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'SERVICE_UPDATED' as AuditAction,
    resource: 'service',
    resourceId: id,
    details: { changes: Object.keys(updateData) },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ service: updatedService }, { message: 'تم تحديث الخدمة بنجاح' })
}

// حذف خدمة
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف الخدمة')
  }

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      hotel: true,
    },
  })

  if (!service) {
    return notFoundResponse('الخدمة')
  }

  // التحقق من الصلاحيات
  if (service.hotel.managerId !== user.userId && !authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف هذه الخدمة')
  }

  await prisma.service.delete({
    where: { id },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'SERVICE_DELETED' as AuditAction,
    resource: 'service',
    resourceId: id,
    details: { name: service.name },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ id }, { message: 'تم حذف الخدمة بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/services/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/services/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/services/[id]' })
