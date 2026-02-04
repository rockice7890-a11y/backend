import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// Schema لفرد العائلة
const familyMemberSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  fullNameAr: z.string().optional(),
  relation: z.enum(['spouse', 'child', 'parent', 'sibling', 'other']),
  gender: z.enum(['male', 'female']).optional(),
  dateOfBirth: z.string().optional(),
  age: z.number().optional(),
  nationality: z.string().optional(),
  idType: z.enum(['national_id', 'passport']).optional(),
  idNumber: z.string().optional(),
  specialNeeds: z.string().optional(),
  notes: z.string().optional(),
})

// الحصول على أفراد العائلة
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { userId: true }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const familyMembers = await prisma.bookingFamilyMember.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: 'asc' }
  })

  return successResponse({ familyMembers })
}

// إضافة فرد عائلة
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const body = await request.json()

  // التحقق من البيانات - دعم إضافة عدة أفراد
  const members = Array.isArray(body) ? body : [body]
  const validatedMembers = members.map(m => familyMemberSchema.parse(m))

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // إضافة أفراد العائلة
  const createdMembers = await Promise.all(
    validatedMembers.map(member =>
      prisma.bookingFamilyMember.create({
        data: {
          bookingId: id,
          ...member,
          dateOfBirth: member.dateOfBirth ? new Date(member.dateOfBirth) : null,
        }
      })
    )
  )

  // تحديث عدد النزلاء في الحجز
  const totalMembers = await prisma.bookingFamilyMember.count({
    where: { bookingId: id }
  })

  await prisma.booking.update({
    where: { id },
    data: { guests: totalMembers + 1 } // +1 للنزيل الرئيسي
  })

  return createdResponse({
    message: `تم إضافة ${createdMembers.length} فرد عائلة`,
    familyMembers: createdMembers,
    totalGuests: totalMembers + 1
  })
}

// حذف فرد عائلة
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const memberId = searchParams.get('memberId')

  if (!memberId) {
    return errorResponse('BAD_REQUEST', 'memberId مطلوب', { status: 400 })
  }

  await prisma.bookingFamilyMember.delete({
    where: { id: memberId }
  })

  // تحديث عدد النزلاء
  const totalMembers = await prisma.bookingFamilyMember.count({
    where: { bookingId: id }
  })

  await prisma.booking.update({
    where: { id },
    data: { guests: totalMembers + 1 }
  })

  return successResponse({
    message: 'تم حذف فرد العائلة',
    totalGuests: totalMembers + 1
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/family' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/family' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/bookings/[id]/family' })
