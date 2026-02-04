import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { PermissionType } from '@/utils/permissions'
import { withErrorHandler } from '@/utils/errorHandler'

// تحديث حالة طلب الخدمة
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
): Promise<NextResponse> => {
  const { id, serviceId } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  if (!authorize(user, PermissionType.BOOKING_UPDATE)) {
    return errorResponse('FORBIDDEN', 'ليس لديك صلاحية', { status: 403 })
  }

  const body = await request.json()
  const { action, notes } = body // approve, complete, cancel

  const bookingService = await prisma.bookingService.findUnique({
    where: { id: serviceId },
    include: { booking: { include: { user: true } }, service: true }
  })

  if (!bookingService) {
    return errorResponse('NOT_FOUND', 'طلب الخدمة غير موجود', { status: 404 })
  }

  if (bookingService.bookingId !== id) {
    return errorResponse('BAD_REQUEST', 'طلب الخدمة لا ينتمي لهذا الحجز', { status: 400 })
  }

  let newStatus = bookingService.status
  let updateData: any = {}

  switch (action) {
    case 'approve':
      if (bookingService.status !== 'PENDING') {
        return errorResponse('BAD_REQUEST', 'لا يمكن الموافقة على هذا الطلب', { status: 400 })
      }
      newStatus = 'APPROVED'
      updateData = {
        status: newStatus,
        approvedBy: user.userId,
        approvedAt: new Date(),
      }
      break

    case 'complete':
      if (!['PENDING', 'APPROVED'].includes(bookingService.status)) {
        return errorResponse('BAD_REQUEST', 'لا يمكن إكمال هذا الطلب', { status: 400 })
      }
      newStatus = 'COMPLETED'
      updateData = {
        status: newStatus,
        completedAt: new Date(),
        ...(bookingService.status === 'PENDING' && {
          approvedBy: user.userId,
          approvedAt: new Date(),
        })
      }
      break

    case 'cancel':
      if (bookingService.status === 'COMPLETED') {
        return errorResponse('BAD_REQUEST', 'لا يمكن إلغاء طلب مكتمل', { status: 400 })
      }
      newStatus = 'CANCELLED'
      updateData = { status: newStatus }
      break

    default:
      return errorResponse('BAD_REQUEST', 'إجراء غير صحيح', { status: 400 })
  }

  if (notes) updateData.notes = notes

  const updated = await prisma.bookingService.update({
    where: { id: serviceId },
    data: updateData,
    include: { service: true }
  })

  // إشعار للنزيل
  const statusMessages: Record<string, string> = {
    APPROVED: 'تمت الموافقة على طلب الخدمة',
    COMPLETED: 'تم تنفيذ الخدمة',
    CANCELLED: 'تم إلغاء طلب الخدمة',
  }

  await prisma.notification.create({
    data: {
      userId: bookingService.booking.userId,
      title: statusMessages[newStatus],
      message: `${bookingService.service.name}: ${statusMessages[newStatus]}`,
      type: 'booking',
    }
  })

  return successResponse({
    message: statusMessages[newStatus],
    service: updated
  })
}

// حذف طلب خدمة
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
): Promise<NextResponse> => {
  const { id, serviceId } = await params;
  const user = await authenticate(request)
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح لك', { status: 401 })
  }

  const bookingService = await prisma.bookingService.findUnique({
    where: { id: serviceId }
  })

  if (!bookingService) {
    return errorResponse('NOT_FOUND', 'طلب الخدمة غير موجود', { status: 404 })
  }

  // فقط الطلبات المعلقة يمكن حذفها
  if (bookingService.status !== 'PENDING') {
    return errorResponse('BAD_REQUEST', 'لا يمكن حذف طلب تمت معالجته', { status: 400 })
  }

  await prisma.bookingService.delete({
    where: { id: serviceId }
  })

  return successResponse({
    message: 'تم حذف طلب الخدمة'
  })
}

export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/bookings/[id]/services/[serviceId]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/bookings/[id]/services/[serviceId]' })
