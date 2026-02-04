import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// تسوية الحساب المرحّل
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request);
  if (!user) {
    return errorResponse('UNAUTHORIZED', 'غير مصرح', { status: 401 })
  }

  // المحاسبين والمديرين يمكنهم تسجيل السداد
  if (!['ACCOUNTANT', 'HOTEL_MANAGER', 'ADMIN'].includes(user.role) &&
    !['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')) {
    return errorResponse('FORBIDDEN', 'غير مصرح', { status: 403 })
  }

  const body = await request.json();
  const { method, reference } = body;

  const deferredAccount = await prisma.deferredAccount.findUnique({
    where: { id },
  });

  if (!deferredAccount) {
    return errorResponse('NOT_FOUND', 'الحساب غير موجود', { status: 404 })
  }

  if (deferredAccount.status !== 'APPROVED' && deferredAccount.status !== 'OVERDUE') {
    return errorResponse('BAD_REQUEST', 'لا يمكن تسجيل السداد إلا للحسابات الموافق عليها', { status: 400 })
  }

  // تحديث الحساب المرحّل
  const updated = await prisma.deferredAccount.update({
    where: { id },
    data: {
      status: 'SETTLED',
      settledAt: new Date(),
      settledBy: user.userId,
      settlementNotes: `Method: ${method}, Ref: ${reference}`,
    },
  });

  // تحديث الفاتورة
  await prisma.invoice.update({
    where: { id: deferredAccount.invoiceId },
    data: {
      status: 'paid',
      amountPaid: deferredAccount.totalAmount || 0,
      amountDue: 0,
      paidAt: new Date(),
      paymentMethod: method || 'cash',
    },
  });

  return successResponse({
    success: true,
    message: 'تم تسجيل سداد الحساب المرحّل',
    data: updated,
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/deferred-accounts/[id]/settle' })
