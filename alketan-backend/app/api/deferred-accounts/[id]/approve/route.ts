import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// موافقة المدير على ترحيل الحساب
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  // فقط SUPER_ADMIN أو ADMIN يمكنهم الموافقة
  const isAuthorized =
    user.adminLevel === 'SUPER_ADMIN' ||
    user.adminLevel === 'SYSTEM_ADMIN' ||
    user.role === 'ADMIN';

  if (!isAuthorized) {
    return forbiddenResponse('فقط مدير التطبيق يمكنه الموافقة على ترحيل الحسابات')
  }

  const body = await request.json();
  const { notes } = body;

  const deferredAccount = await prisma.deferredAccount.findUnique({
    where: { id },
  });

  if (!deferredAccount) {
    return notFoundResponse('الطلب')
  }

  if (deferredAccount.status !== 'PENDING') {
    return errorResponse('BAD_REQUEST', 'الطلب تمت معالجته مسبقاً')
  }

  // تحديث الحساب المرحّل
  const updated = await prisma.deferredAccount.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedBy: user.userId,
      approvedAt: new Date(),
      approvalNotes: notes,
    },
  });

  // تحديث الفاتورة
  await prisma.invoice.update({
    where: { id: deferredAccount.invoiceId },
    data: {
      isDeferred: true,
      deferredTo: deferredAccount.deferredTo,
      deferredReason: deferredAccount.reason,
      deferredApprovedBy: user.userId,
      status: 'deferred',
    },
  });

  return successResponse({
    updated,
  }, { message: 'تمت الموافقة على ترحيل الحساب' });
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/deferred-accounts/[id]/approve' })
