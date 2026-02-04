import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// Schema للتحقق من بيانات النزيل
const guestDetailsSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  fullNameAr: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().min(10),
  phoneAlt: z.string().optional(),
  nationality: z.string().min(2),
  country: z.string().min(2),
  idType: z.enum(['national_id', 'passport', 'residence']),
  idNumber: z.string().min(5),
  idExpiryDate: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  organization: z.string().optional(),
  jobTitle: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
  dateOfBirth: z.string().optional(),
  specialNeeds: z.string().optional(),
  notes: z.string().optional(),
})

// الحصول على بيانات النزيل
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
    include: {
      guestDetails: true,
      familyMembers: true,
      user: { select: { id: true, name: true, email: true, phone: true } }
    }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // التحقق من الصلاحية
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  return successResponse({
    guestDetails: booking.guestDetails,
    familyMembers: booking.familyMembers,
    isComplete: !!booking.guestDetails
  })
}

// إضافة/تحديث بيانات النزيل (من قبل الموظف)
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

  // التحقق من البيانات
  const validatedData = guestDetailsSchema.parse(body)

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { guestDetails: true }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (!['APPROVED', 'CONFIRMED'].includes(booking.status)) {
    return errorResponse('BAD_REQUEST', 'يجب الموافقة على الحجز أولاً', { status: 400 })
  }

  // تحويل التواريخ
  const guestData = {
    ...validatedData,
    idExpiryDate: validatedData.idExpiryDate ? new Date(validatedData.idExpiryDate) : null,
    dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : null,
    filledBy: user.userId,
    filledAt: new Date(),
  }

  let guestDetails
  if (booking.guestDetails) {
    // تحديث البيانات الموجودة
    guestDetails = await prisma.guestDetails.update({
      where: { bookingId: id },
      data: guestData
    })
  } else {
    // إنشاء بيانات جديدة
    guestDetails = await prisma.guestDetails.create({
      data: {
        bookingId: id,
        ...guestData
      }
    })
  }

  // تحديث حالة الحجز إلى CONFIRMED
  await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED' }
  })

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'UPDATE_GUEST_DETAILS',
      resource: 'booking',
      resourceId: id,
    }
  })

  return successResponse({
    message: 'تم حفظ بيانات النزيل بنجاح',
    guestDetails,
    bookingStatus: 'CONFIRMED'
  })
}

// التحقق من بيانات النزيل
const handlePatch = async (
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

  const guestDetails = await prisma.guestDetails.findUnique({
    where: { bookingId: id }
  })

  if (!guestDetails) {
    return errorResponse('NOT_FOUND', 'بيانات النزيل غير موجودة', { status: 404 })
  }

  // تحديث حالة التحقق
  const updated = await prisma.guestDetails.update({
    where: { bookingId: id },
    data: {
      isVerified: true,
      verifiedBy: user.userId,
      verifiedAt: new Date()
    }
  })

  return successResponse({
    message: 'تم التحقق من البيانات بنجاح',
    guestDetails: updated
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/guest-details' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/guest-details' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/bookings/[id]/guest-details' })
