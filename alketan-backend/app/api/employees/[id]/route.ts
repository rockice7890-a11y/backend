import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/middleware/auth';
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse } from '@/utils/apiResponse';
import { withErrorHandler } from '@/utils/errorHandler';

// تعديل موظف
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  if (!['ADMIN'].includes(user.role) &&
    !['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '')) {
    return forbiddenResponse('غير مصرح')
  }

  const body = await request.json();
  const { firstName, lastName, phone, role, isActive } = body;

  const employee = await prisma.user.findUnique({ where: { id } });
  if (!employee) {
    return notFoundResponse('الموظف')
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(firstName && lastName && { name: `${firstName} ${lastName}` }),
      ...(phone && { phone }),
      ...(role && { role }),
      ...(typeof isActive === 'boolean' && { isActive }),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
    },
  });

  return successResponse(updated)
};

// حذف/تعطيل موظف
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  if (!['SUPER_ADMIN'].includes(user.adminLevel || '')) {
    return forbiddenResponse('فقط المدير الرئيسي يمكنه حذف الموظفين')
  }

  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  return successResponse(null, { message: 'تم تعطيل الموظف' })
};

export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/employees/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/employees/[id]' })
