import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على رسائل الحجز
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

  // التحقق من الصلاحية
  if (booking.userId !== user.userId && !authorize(user, PermissionType.BOOKING_READ)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const messages = await prisma.bookingMessage.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: 'asc' }
  })

  // تحديث الرسائل كمقروءة
  const unreadMessages = messages.filter(m => !m.isRead && m.senderId !== user.userId)
  if (unreadMessages.length > 0) {
    await prisma.bookingMessage.updateMany({
      where: {
        id: { in: unreadMessages.map(m => m.id) }
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    })
  }

  return successResponse({ messages })
}

// إرسال رسالة
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const body = await request.json()
  const { message, messageType = 'text' } = body

  if (!message || message.trim() === '') {
    return errorResponse('BAD_REQUEST', 'الرسالة مطلوبة', { status: 400 })
  }

  // التحقق من الحجز
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user: true,
      hotel: {
        select: {
          managerId: true
        }
      }
    }
  })

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  // تحديد نوع المرسل
  const isStaff = authorize(user, PermissionType.BOOKING_UPDATE)
  const senderType = isStaff ? 'staff' : 'guest'

  // التحقق من الصلاحية
  if (!isStaff && booking.userId !== user.userId) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  // إنشاء الرسالة
  const newMessage = await prisma.bookingMessage.create({
    data: {
      bookingId: id,
      senderId: user.userId,
      senderType,
      message: message.trim(),
      messageType,
    }
  })

  // إنشاء إشعار للمستلم
  const recipientId = isStaff ? booking.userId : (booking as any).hotel?.managerId
  if (recipientId) {
    await prisma.notification.create({
      data: {
        userId: recipientId,
        title: 'رسالة جديدة',
        message: `لديك رسالة جديدة بخصوص الحجز #${booking.bookingReference}`,
        type: 'booking',
        link: `/bookings/${booking.id}`,
      }
    })
  }

  return createdResponse({
    message: 'تم إرسال الرسالة',
    bookingMessage: newMessage
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/bookings/[id]/messages' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/bookings/[id]/messages' })
