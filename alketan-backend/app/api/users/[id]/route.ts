import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize } from '@/middleware/auth'
import { errorResponse, successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { Permissions, PermissionType } from '@/utils/permissions'
import { AdminLevel } from '@prisma/client'
import { updateUserSchema } from '@/utils/validation'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

// الحصول على مستخدم محدد
const handleGet = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // يمكن للمستخدم رؤية بياناته الخاصة أو من لديه صلاحية USER_READ
  if (user.userId !== id && !authorize(user, PermissionType.USER_READ)) {
    return forbiddenResponse('ليس لديك صلاحية لعرض هذا المستخدم')
  }

  const userData = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!userData) {
    return notFoundResponse('المستخدم')
  }

  // تسجيل الوصول
  await createAuditLog({
    userId: user.userId,
    action: 'USER_READ' as AuditAction,
    resource: 'user',
    resourceId: id,
    details: { action: 'view_single' },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ user: userData })
}

// تحديث مستخدم
const handlePatch = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  // يمكن للمستخدم تحديث بياناته الخاصة أو من لديه صلاحية USER_UPDATE
  if (user.userId !== id && !authorize(user, PermissionType.USER_UPDATE)) {
    return forbiddenResponse('ليس لديك صلاحية لتحديث هذا المستخدم')
  }

  const body = await request.json()
  const validatedData = updateUserSchema.parse(body)

  // التحقق من وجود المستخدم
  const existingUser = await prisma.user.findUnique({
    where: { id },
  })

  if (!existingUser) {
    return notFoundResponse('المستخدم')
  }

  // تحديث كلمة المرور إذا تم إرسالها
  const updateData: any = { ...validatedData }
  if (body.password) {
    const { hashPassword } = await import('@/utils/auth')
    updateData.password = await hashPassword(body.password)
  }

  // حماية الحقول الحساسة: فقط الـ SUPER_ADMIN يمكنه تغيير Role أو AdminLevel للآخرين
  if (validatedData.role || body.adminLevel) {
    if (user.adminLevel !== AdminLevel.SUPER_ADMIN) {
      delete updateData.role
      delete updateData.adminLevel
    }
  }

  // منع أي شخص من تغيير رتبته الخاصة لـ SUPER_ADMIN أو تغيير دوره لمدير نظام
  if (user.userId === id) {
    delete updateData.role
    delete updateData.adminLevel
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      updatedAt: true,
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'USER_UPDATED' as AuditAction,
    resource: 'user',
    resourceId: id,
    details: { changes: Object.keys(updateData) },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ user: updatedUser }, { message: 'تم تحديث المستخدم بنجاح' })
}

// حذف مستخدم
const handleDelete = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await params;
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (!authorize(user, PermissionType.USER_DELETE)) {
    return forbiddenResponse('ليس لديك صلاحية لحذف المستخدم')
  }

  // منع حذف المستخدم نفسه
  if (user.userId === id) {
    return errorResponse('BAD_REQUEST', 'لا يمكنك حذف حسابك الخاص')
  }

  const deletedUser = await prisma.user.delete({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'USER_DELETED' as AuditAction,
    resource: 'user',
    resourceId: id,
    details: { email: deletedUser.email, name: deletedUser.name },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ user: deletedUser }, { message: 'تم حذف المستخدم بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/users/[id]' })
export const PATCH = withErrorHandler(handlePatch, { method: 'PATCH', path: '/api/users/[id]' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/users/[id]' })
