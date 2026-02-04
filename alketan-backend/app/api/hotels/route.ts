import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize, requireAuth, requireRateLimit } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { hotelSchema } from '@/utils/validation'
import { successResponse, errorResponse, notFoundResponse, createdResponse, paginatedResponse, forbiddenResponse, unauthorizedResponse, validationProblem } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import crypto from 'crypto'
import { withErrorHandler } from '@/utils/errorHandler'

// توليد كود فندق فريد
function generateHotelCode(name: string): string {
  const prefix = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `HTL-${prefix}-${randomPart}`
}

// الحصول على جميع الفنادق
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  // التحقق من Rate Limit أولاً
  const rateLimitResult = await requireRateLimit(request)
  if (rateLimitResult instanceof NextResponse) {
    return rateLimitResult
  }

  const authResult = await requireAuth(request, PermissionType.HOTEL_READ)
  if (authResult) return authResult

  const { user } = (request as any)
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')
  const country = searchParams.get('country')
  const isActive = searchParams.get('isActive')
  const managerId = searchParams.get('managerId')
  const hotelCode = searchParams.get('hotelCode')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100) // Max 100 per page

  const where: any = {}
  if (city) where.city = { contains: city, mode: 'insensitive' }
  if (country) where.country = { contains: country, mode: 'insensitive' }
  if (isActive !== null) where.isActive = isActive === 'true'
  if (managerId) where.managerId = managerId
  if (hotelCode) where.hotelCode = hotelCode

  const [hotels, total] = await Promise.all([
    prisma.hotel.findMany({
      where,
      select: {  // استخدام select بدلاً من include لتحسين الأداء (N+1 fix)
        id: true,
        name: true,
        nameAr: true,
        city: true,
        country: true,
        rating: true,
        hotelCode: true,
        isActive: true,
        createdAt: true,
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        _count: {
          select: {
            rooms: true,
            bookings: true,
            reviews: true,
            services: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.hotel.count({ where })
  ])

  return paginatedResponse(hotels, total, page, limit, {
    message: `تم العثور على ${total} فندق`
  })
}

// إنشاء فندق جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  // التحقق من Rate Limit
  const rateLimitResult = await requireRateLimit(request)
  if (rateLimitResult instanceof NextResponse) {
    return rateLimitResult
  }

  const authResult = await requireAuth(request, PermissionType.HOTEL_CREATE)
  if (authResult) return authResult

  const { user } = (request as any)

  const body = await request.json()
  const validatedData = hotelSchema.parse(body)

  // توليد كود فريد للفندق
  const hotelCode = generateHotelCode(validatedData.name)

  // التأكد من عدم تكرار الكود
  const existingHotel = await prisma.hotel.findFirst({
    where: { hotelCode }
  })

  const finalCode = existingHotel
    ? generateHotelCode(validatedData.name)
    : hotelCode

  const hotel = await prisma.hotel.create({
    data: {
      ...validatedData,
      hotelCode: finalCode,
      managerId: body.managerId || user.userId,
    },
    select: {  // استخدام select بدلاً من include لتحسين الأداء
      id: true,
      name: true,
      nameAr: true,
      city: true,
      country: true,
      hotelCode: true,
      rating: true,
      manager: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'HOTEL_CREATED' as AuditAction,
    resource: 'hotel',
    resourceId: hotel.id,
    details: { hotelCode: finalCode, name: hotel.name },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  })

  return createdResponse({ hotel }, {
    message: 'تم إنشاء الفندق بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/hotels' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/hotels' })
