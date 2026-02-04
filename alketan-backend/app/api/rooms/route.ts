import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize, requireAuth } from '@/middleware/auth'
import { successResponse, errorResponse, paginatedResponse, validationProblem, notFoundResponse, forbiddenResponse, conflictResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { PermissionType, Permissions } from '@/utils/permissions'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// Schema لإنشاء/تحديث الغرفة
const roomRequestSchema = z.object({
  number: z.string().min(1),
  type: z.enum(['SINGLE', 'DOUBLE', 'SUITE', 'DELUXE', 'FAMILY', 'PRESIDENTIAL']),
  floor: z.number().min(1),
  basePrice: z.number().min(0),
  capacity: z.number().min(1),
  size: z.number().optional(),
  description: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  isAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true),
})

// الحصول على جميع الغرف
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request)
  if (authResult) return authResult

  const { user } = request as any
  const { searchParams } = new URL(request.url)

  const hotelId = searchParams.get('hotelId')
  const type = searchParams.get('type')
  const status = searchParams.get('status') // AVAILABLE, OCCUPIED, MAINTENANCE, CLEANING
  const minPrice = searchParams.get('minPrice')
  const maxPrice = searchParams.get('maxPrice')
  const floor = searchParams.get('floor')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const where: any = {}

  // المستخدمون العاديون يرون فقط الغرف المتاحة
  if (user.role === 'USER' || user.role === 'GUEST') {
    where.isAvailable = true
    where.isActive = true
  } else {
    if (hotelId) where.hotelId = hotelId
    if (type) where.type = type
    if (status) where.status = status
    if (floor) where.floor = parseInt(floor)

    if (minPrice || maxPrice) {
      where.basePrice = {}
      if (minPrice) where.basePrice.gte = parseFloat(minPrice)
      if (maxPrice) where.basePrice.lte = parseFloat(maxPrice)
    }
  }

  const [rooms, total] = await Promise.all([
    prisma.room.findMany({
      where,
      include: {
        hotel: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
        bookings: {
          where: {
            status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
            OR: [
              { AND: [{ checkIn: { lte: new Date() } }, { checkOut: { gt: new Date() } }] }
            ]
          },
          select: { id: true, checkIn: true, checkOut: true }
        },
        _count: {
          select: {
            bookings: true,
            maintenanceRecords: true
          },
        },
      },
      orderBy: [{ hotelId: 'asc' }, { number: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.room.count({ where })
  ])

  // تسجيل الوصول
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_READ' as AuditAction,
    resource: 'rooms',
    details: { action: 'list', filters: { hotelId, type, status } },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return paginatedResponse(rooms, total, page, limit)
}

// إنشاء غرفة جديدة
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.ROOM_CREATE)
  if (authResult) return authResult

  const { user } = request as any

  const body = await request.json()
  const validatedData = roomRequestSchema.parse(body)

  if (!body.hotelId) {
    return errorResponse('BAD_REQUEST', 'معرف الفندق مطلوب')
  }

  // التحقق من وجود الفند
  const hotel = await prisma.hotel.findUnique({
    where: { id: body.hotelId },
  })

  if (!hotel) {
    return notFoundResponse('الفندق')
  }

  // التحقق من الصلاحيات: المدير أو صاحب الفندق
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإضافة غرف لهذا الفندق')
  }

  // التحقق من عدم تكرار رقم الغرفة في نفس الفندق
  const existingRoom = await prisma.room.findUnique({
    where: {
      hotelId_number: {
        hotelId: body.hotelId,
        number: validatedData.number,
      },
    },
  })

  if (existingRoom) {
    return conflictResponse('رقم الغرفة مستخدم بالفعل في هذا الفندق')
  }

  const room = await prisma.room.create({
    data: {
      hotelId: body.hotelId,
      number: validatedData.number,
      type: validatedData.type,
      floor: validatedData.floor,
      basePrice: validatedData.basePrice,
      capacity: validatedData.capacity,
      size: validatedData.size,
      description: validatedData.description,
      amenities: validatedData.amenities,
      images: validatedData.images,
      isAvailable: validatedData.isAvailable,
      isActive: validatedData.isActive,
    },
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
    action: 'ROOM_CREATED' as AuditAction,
    resource: 'room',
    resourceId: room.id,
    details: {
      roomNumber: room.number,
      hotelId: room.hotelId,
      roomType: room.type,
      price: room.basePrice
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ room }, { message: 'تم إنشاء الغرفة بنجاح', code: 'CREATED' })
}

// PUT /api/rooms/[id] - تحديث غرفة
const handlePut = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.ROOM_UPDATE)
  if (authResult) return authResult

  const { user } = request as any
  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get('id')

  if (!roomId) {
    return errorResponse('BAD_REQUEST', 'معرف الغرفة مطلوب')
  }

  const body = await request.json()
  const validatedData = roomRequestSchema.partial().parse(body)

  // التحقق من وجود الغرفة
  const existingRoom = await prisma.room.findUnique({
    where: { id: roomId },
    include: { hotel: true }
  })

  if (!existingRoom) {
    return notFoundResponse('الغرفة')
  }

  // التحقق من الصلاحيات
  if (existingRoom.hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتعديل غرف هذا الفندق')
  }

  // التحقق من تكرار رقم الغرفة
  if (validatedData.number && validatedData.number !== existingRoom.number) {
    const duplicateRoom = await prisma.room.findUnique({
      where: {
        hotelId_number: {
          hotelId: existingRoom.hotelId,
          number: validatedData.number,
        },
      },
    })

    if (duplicateRoom) {
      return conflictResponse('رقم الغرفة مستخدم بالفعل')
    }
  }

  // حساب السعر الجديد إذا تغير
  let priceChange = null
  if (validatedData.basePrice !== undefined) {
    priceChange = validatedData.basePrice - existingRoom.basePrice
  }

  const updatedRoom = await prisma.room.update({
    where: { id: roomId },
    data: validatedData,
    include: {
      hotel: {
        select: { id: true, name: true, city: true }
      }
    }
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_UPDATED' as AuditAction,
    resource: 'room',
    resourceId: roomId,
    details: {
      changes: Object.keys(validatedData),
      priceChange
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ room: updatedRoom }, { message: 'تم تحديث الغرفة بنجاح' })
}

// DELETE /api/rooms/[id] - حذف/تعطيل غرفة
const handleDelete = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.ROOM_DELETE)
  if (authResult) return authResult

  const { user } = request as any
  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get('id')

  if (!roomId) {
    return errorResponse('BAD_REQUEST', 'معرف الغرفة مطلوب')
  }

  const existingRoom = await prisma.room.findUnique({
    where: { id: roomId },
    include: { hotel: true }
  })

  if (!existingRoom) {
    return notFoundResponse('الغرفة')
  }

  // التحقق من الصلاحيات
  if (existingRoom.hotel.managerId !== user.userId && !authorize(user, PermissionType.HOTEL_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف غرف هذا الفندق')
  }

  // التحقق من عدم وجود حجوزات نشطة
  const activeBookings = await prisma.booking.count({
    where: {
      roomId,
      status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }
    }
  })

  if (activeBookings > 0) {
    return conflictResponse('لا يمكن حذف الغرفة لوجود حجوزات نشطة عليها')
  }

  // تعطيل الغرفة بدلاً من حذفها
  await prisma.room.update({
    where: { id: roomId },
    data: { isActive: false, isAvailable: false }
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_DELETED' as AuditAction,
    resource: 'room',
    resourceId: roomId,
    details: {
      roomNumber: existingRoom.number,
      hotelId: existingRoom.hotelId
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({
    roomId,
    message: 'تم تعطيل الغرفة بنجاح (لم يتم الحذف النهائي)'
  }, { message: 'تم تعطيل الغرفة بنجاح' })
}

// PATCH /api/rooms/[id]/status - تحديث حالة الغرفة
const handlePatch = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request)
  if (authResult) return authResult

  const { user } = (request as any)
  const { searchParams } = new URL(request.url)
  const roomId = searchParams.get('id')

  if (!roomId) {
    return errorResponse('BAD_REQUEST', 'معرف الغرفة مطلوب')
  }

  const body = await request.json()
  const { status, maintenanceReason } = body

  // التحقق من صحة الحالة
  const validStatuses = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'CLEANING', 'BLOCKED']
  if (!validStatuses.includes(status)) {
    return errorResponse('BAD_REQUEST', 'حالة الغرفة غير صالحة')
  }

  const existingRoom = await prisma.room.findUnique({
    where: { id: roomId }
  })

  if (!existingRoom) {
    return notFoundResponse('الغرفة')
  }

  // التحقق من الحجوزات النشطة إذا كانت الحالة OCCUPIED
  if (status === 'OCCUPIED') {
    const activeBooking = await prisma.booking.findFirst({
      where: {
        roomId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: new Date() },
        checkOut: { gt: new Date() }
      }
    })

    if (!activeBooking) {
      return errorResponse('BAD_REQUEST', 'لا يوجد نزيل حالياً في هذه الغرفة')
    }
  }

  // تحديث الحالة
  const updatedRoom = await prisma.room.update({
    where: { id: roomId },
    data: {
      status,
      isAvailable: status === 'AVAILABLE'
    }
  })

  // إنشاء سجل صيانة إذا كانت الحالة MAINTENANCE
  if (status === 'MAINTENANCE') {
    await prisma.maintenanceRecord.create({
      data: {
        roomId,
        reason: maintenanceReason || 'صيانة عامة',
        reportedBy: user.userId,
        status: 'IN_PROGRESS'
      }
    })
  }

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'ROOM_STATUS_CHANGED' as AuditAction,
    resource: 'room',
    resourceId: roomId,
    details: {
      oldStatus: existingRoom.status,
      newStatus: status,
      reason: maintenanceReason
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({
    room: updatedRoom,
    previousStatus: existingRoom.status
  }, { message: 'تم تحديث حالة الغرفة بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/rooms' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/rooms' })
export const PUT = withErrorHandler(handlePut, { method: 'PUT', path: '/api/rooms' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/rooms' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/rooms' })
