import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { roomSchema } from '@/utils/validation'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على غرفة محددة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      hotel: {
        select: {
          id: true,
          name: true,
          city: true,
          address: true,
          phone: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: ['CONFIRMED', 'CHECKED_IN'],
          },
        },
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          status: true,
        },
      },
    },
  })

  if (!room) {
    return notFoundResponse('الغرفة')
  }

  // تسجيل الوصول
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_READ' as AuditAction,
    resource: 'room',
    resourceId: room.id,
    details: { action: 'view_single' },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ room })
}

// تحديث غرفة
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      hotel: true,
    },
  })

  if (!room) {
    return notFoundResponse('الغرفة')
  }

  // التحقق من الصلاحيات
  if (room.hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذه الغرفة')
  }

  const body = await request.json()
  const validatedData = roomSchema.partial().parse(body)

  // التحقق من عدم تكرار رقم الغرفة إذا تم تغييره
  if (validatedData.number && validatedData.number !== room.number) {
    const existingRoom = await prisma.room.findUnique({
      where: {
        hotelId_number: {
          hotelId: room.hotelId,
          number: validatedData.number,
        },
      },
    })

    if (existingRoom) {
      return errorResponse('BAD_REQUEST', 'رقم الغرفة مستخدم بالفعل في هذا الفندق')
    }
  }

  const updatedRoom = await prisma.room.update({
    where: { id },
    data: validatedData,
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
    action: 'ROOM_UPDATED' as AuditAction,
    resource: 'room',
    resourceId: id,
    details: { changes: Object.keys(validatedData) },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ room: updatedRoom }, { message: 'تم تحديث الغرفة بنجاح' })
}

// حذف غرفة
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      hotel: true,
    },
  })

  if (!room) {
    return notFoundResponse('الغرفة')
  }

  // التحقق من الصلاحيات
  if (room.hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف هذه الغرفة')
  }

  const deletedRoom = await prisma.room.delete({
    where: { id },
    select: {
      id: true,
      number: true,
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_DELETED' as AuditAction,
    resource: 'room',
    resourceId: id,
    details: { roomNumber: deletedRoom.number },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ room: deletedRoom }, { message: 'تم حذف الغرفة بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/rooms/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/rooms/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/rooms/[id]' })
