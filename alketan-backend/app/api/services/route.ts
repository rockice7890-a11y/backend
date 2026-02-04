import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, paginatedResponse, createdResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

const serviceSchema = z.object({
  hotelId: z.string().min(1, 'معرف الفندق مطلوب'),
  name: z.string().min(1, 'اسم الخدمة مطلوب'),
  nameAr: z.string().optional(),
  description: z.string().optional(),
  price: z.number().positive('السعر يجب أن يكون موجب'),
  category: z.string().min(1, 'الفئة مطلوبة'),
})

// الحصول على جميع الخدمات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const { searchParams } = new URL(request.url)
  const hotelId = searchParams.get('hotelId')
  const category = searchParams.get('category')
  const isActive = searchParams.get('isActive')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const where: any = {}
  if (hotelId) where.hotelId = hotelId
  if (category) where.category = category
  if (isActive !== null) where.isActive = isActive === 'true'

  const [services, total] = await Promise.all([
    prisma.service.findMany({
      where,
      include: {
        hotel: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
        _count: {
          select: {
            bookings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.service.count({ where })
  ])

  return paginatedResponse(services, total, page, limit, {
    message: 'تم جلب الخدمات بنجاح'
  })
}

// إنشاء خدمة جديدة
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإنشاء خدمة')
  }

  const body = await request.json()
  const validatedData = serviceSchema.parse(body)

  // التحقق من وجود الفندق
  const hotel = await prisma.hotel.findUnique({
    where: { id: validatedData.hotelId },
  })

  if (!hotel) {
    return notFoundResponse('الفندق')
  }

  // التحقق من الصلاحيات
  if (hotel.managerId !== user.userId && !authorize(user, PermissionType.FEATURE_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لإضافة خدمات لهذا الفندق')
  }

  const service = await prisma.service.create({
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
    action: 'SERVICE_CREATED' as AuditAction,
    resource: 'service',
    resourceId: service.id,
    details: { name: service.name, category: service.category, hotelId: service.hotelId },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({ service }, {
    message: 'تم إنشاء الخدمة بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/services' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/services' })
