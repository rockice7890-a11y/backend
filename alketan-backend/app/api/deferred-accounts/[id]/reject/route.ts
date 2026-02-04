import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

// رفض المدير لترحيل الحساب
const handlePost = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  // فقط SUPER_ADMIN أو ADMIN يمكنهم الرفض
  const isAuthorized =
    user.adminLevel === 'SUPER_ADMIN' ||
    user.adminLevel === 'SYSTEM_ADMIN' ||
    user.role === 'ADMIN';

  if (!isAuthorized) {
    return forbiddenResponse('فقط مدير التطبيق يمكنه رفض ترحيل الحسابات')
  }
  const body = await request.json();
  const { reason } = body;

  if (!reason) {
    return validationProblem([{ field: 'reason', message: 'سبب الرفض مطلوب' }])
  }

  const deferredAccount = await prisma.deferredAccount.findUnique({
    where: { id },
  });

  if (!deferredAccount) {
    return notFoundResponse('الطلب')
  }

  if (deferredAccount.status !== 'PENDING') {
    return errorResponse('BAD_REQUEST', 'الطلب تمت معالجته مسبقاً')
  }

  const updated = await prisma.deferredAccount.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectedBy: user.userId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });

  return successResponse({
    updated,
  }, { message: 'تم رفض طلب ترحيل الحساب' });
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/deferred-accounts/[id]/reject' })
