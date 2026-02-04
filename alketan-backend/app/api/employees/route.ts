import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorize } from '@/middleware/auth';
import { PermissionType } from '@/utils/permissions';
import { successResponse, errorResponse, createdResponse, paginatedResponse, unauthorizedResponse, forbiddenResponse, validationProblem } from '@/utils/apiResponse';
import { createAuditLog, AuditAction } from '@/utils/auditLogger';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withErrorHandler } from '@/utils/errorHandler';

// التحقق من بيانات الموظف
const employeeSchema = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
  firstName: z.string().min(1, 'الاسم الأول مطلوب'),
  lastName: z.string().min(1, 'الاسم الأخير مطلوب'),
  phone: z.string().optional(),
  role: z.enum(['RECEPTIONIST', 'ACCOUNTANT', 'HOTEL_MANAGER'], {
    errorMap: () => ({ message: 'دور غير صالح' })
  }),
  hotelId: z.string().optional(),
});

// قائمة الموظفين
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  const hasPermission = authorize(user, PermissionType.HOTEL_MANAGE_STAFF) ||
    ['HOTEL_MANAGER', 'ADMIN'].includes(user.role) ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'HOTEL_ADMIN'].includes(user.adminLevel || '');

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لعرض الموظفين')
  }

  const { searchParams } = new URL(request.url);
  const hotelId = searchParams.get('hotelId');
  const role = searchParams.get('role');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');

  const where: any = {
    role: { in: ['RECEPTIONIST', 'ACCOUNTANT', 'HOTEL_MANAGER'] },
  };
  if (role) where.role = role;
  if (hotelId) where.hotelId = hotelId;

  const [employees, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        phone: true,
        role: true,
        adminLevel: true,
        isActive: true,
        hotelId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where })
  ]);

  return paginatedResponse(employees, total, page, limit, {
    message: 'تم جلب الموظفين بنجاح'
  });
};

// إضافة موظف جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request);
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  const hasPermission = authorize(user, PermissionType.USER_CREATE) ||
    user.role === 'ADMIN' ||
    ['SUPER_ADMIN', 'SYSTEM_ADMIN'].includes(user.adminLevel || '');

  if (!hasPermission) {
    return forbiddenResponse('ليس لديك صلاحية لإضافة موظف')
  }

  const body = await request.json();
  const validatedResult = employeeSchema.safeParse(body);

  if (!validatedResult.success) {
    return validationProblem(validatedResult.error.errors.map((e: any) => ({
      field: e.path.join('.'),
      message: e.message
    })))
  }

  const validatedData = validatedResult.data;

  // التحقق من وجود المستخدم
  const existingUser = await prisma.user.findUnique({
    where: { email: validatedData.email }
  });

  if (existingUser) {
    return errorResponse('DUPLICATE_ENTRY', 'البريد الإلكتروني مستخدم')
  }

  const hashedPassword = await bcrypt.hash(validatedData.password, 12);

  const employee = await prisma.user.create({
    data: {
      email: validatedData.email,
      password: hashedPassword,
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      name: `${validatedData.firstName} ${validatedData.lastName}`,
      phone: validatedData.phone,
      role: validatedData.role,
      hotelId: validatedData.hotelId || null,
      createdById: user.userId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      hotelId: true,
      createdAt: true,
    },
  });

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'USER_CREATED' as AuditAction,
    resource: 'employee',
    resourceId: employee.id,
    details: {
      email: employee.email,
      role: employee.role,
      firstName: employee.firstName,
      lastName: employee.lastName
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return createdResponse({ employee }, {
    message: 'تم إضافة الموظف بنجاح'
  });
};

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/employees' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/employees' })
