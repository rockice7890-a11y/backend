import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, createdResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// قائمة طلبات ترحيل الحسابات
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح', { status: 401 })
  }

  // فقط المديرين يمكنهم رؤية الحسابات المرحّلة
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role) && user.adminLevel !== 'SUPER_ADMIN') {
    return errorResponse('FORBIDDEN', 'غير مصرح', { status: 403 })
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const hotelId = searchParams.get('hotelId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const where: any = {};
  if (status) where.status = status;
  if (hotelId) where.hotelId = hotelId;

  const [accounts, total] = await Promise.all([
    prisma.deferredAccount.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.deferredAccount.count({ where }),
  ]);

  return successResponse({
    success: true,
    data: accounts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
};

// إنشاء طلب ترحيل حساب جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح', { status: 401 })
  }

  // الموظفين والمديرين يمكنهم طلب الترحيل
  if (!['RECEPTIONIST', 'ACCOUNTANT', 'HOTEL_MANAGER', 'ADMIN'].includes(user.role)) {
    return errorResponse('FORBIDDEN', 'غير مصرح', { status: 403 })
  }

  const body = await request.json();
  const { bookingId, deferredTo, reason, dueDate } = body;

  if (!bookingId || !deferredTo) {
    return errorResponse('BAD_REQUEST', 'bookingId و deferredTo مطلوبان', { status: 400 })
  }

  // التحقق من الحجز والفاتورة
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { invoice: true },
  });

  if (!booking) {
    return errorResponse('NOT_FOUND', 'الحجز غير موجود', { status: 404 })
  }

  if (!booking.invoice) {
    return errorResponse('BAD_REQUEST', 'لا توجد فاتورة لهذا الحجز', { status: 400 })
  }

  // التحقق من عدم وجود طلب ترحيل سابق
  const existingDeferred = await prisma.deferredAccount.findUnique({
    where: { invoiceId: booking.invoice.id },
  });

  if (existingDeferred) {
    return errorResponse('CONFLICT', 'يوجد طلب ترحيل سابق لهذه الفاتورة', { status: 400 })
  }

  const deferredAmount = booking.invoice.amountDue;

  const deferredAccount = await prisma.deferredAccount.create({
    data: {
      invoiceId: booking.invoice.id,
      userId: booking.userId,
      amount: deferredAmount || 0,
      bookingId: booking.id,
      hotelId: booking.hotelId,
      guestId: booking.userId,
      totalAmount: booking.invoice.total,
      paidAmount: booking.invoice.amountPaid,
      deferredTo,
      reason,
      dueDate: dueDate ? new Date(dueDate) : null,
      requestedBy: user.userId,
      status: 'PENDING',
    },
  });

  return createdResponse({
    success: true,
    message: 'تم إرسال طلب الترحيل للمدير للموافقة',
    data: deferredAccount,
  })
};

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/deferred-accounts' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/deferred-accounts' })
