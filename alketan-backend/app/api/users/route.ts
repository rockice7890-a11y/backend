import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, authorize, requireAuth, PERMISSIONS } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { registerSchema, updateUserSchema } from '@/utils/validation'
import { successResponse, errorResponse, paginatedResponse, validationProblem, forbiddenResponse, notFoundResponse, conflictResponse, createdResponse, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { hashPassword, verifyPassword, encrypt, decrypt } from '@/utils/encryption'
import { z } from 'zod'
import { withErrorHandler } from '@/utils/errorHandler'

// Schema لتحديث المستخدم
const updateUserRequestSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  role: z.enum(['USER', 'GUEST', 'ADMIN', 'HOTEL_MANAGER', 'RECEPTIONIST', 'ACCOUNTANT']).optional(),
  adminLevel: z.enum(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'HOTEL_ADMIN', 'DEPARTMENT_HEAD', 'SUPERVISOR']).nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
})

// الحصول على جميع المستخدمين
const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.USER_READ)
  if (authResult) return authResult

  const { user } = request as any
  const { searchParams } = new URL(request.url)

  const role = searchParams.get('role')
  const isActive = searchParams.get('isActive')
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const where: any = {}

  if (role) where.role = role
  if (isActive !== null) where.isActive = isActive === 'true'

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } }
    ]
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
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
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where })
  ])

  // تسجيل الوصول
  await createAuditLog({
    userId: user.userId,
    action: 'USER_READ' as AuditAction,
    resource: 'users',
    details: { action: 'list', filters: { role, isActive, search } },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return paginatedResponse(users, total, page, limit)
}

// إنشاء مستخدم جديد
const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.USER_CREATE)
  if (authResult) return authResult

  const { user } = request as any

  const body = await request.json()
  const validatedData = registerSchema.parse(body)

  // التحقق من وجود البريد الإلكتروني
  if (body.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    })
    if (existingUser) {
      return conflictResponse('البريد الإلكتروني مستخدم بالفعل')
    }
  }

  // تشفير كلمة المرور
  const hashedPassword = await hashPassword(body.password)

  // تشفير البيانات الحساسة
  const encryptedPhone = body.phone ? encrypt(body.phone) : null

  const newUser = await prisma.user.create({
    data: {
      email: validatedData.email,
      password: hashedPassword,
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      name: validatedData.name || `${validatedData.firstName} ${validatedData.lastName}`,
      phone: encryptedPhone,
      role: validatedData.role || 'USER',
      adminLevel: (validatedData as any).adminLevel || null,
      isActive: true,
      createdById: user.userId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      adminLevel: true,
      isActive: true,
      createdAt: true,
    },
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'USER_CREATED' as AuditAction,
    resource: 'user',
    resourceId: newUser.id,
    details: {
      email: newUser.email,
      role: newUser.role,
      createdBy: user.userId
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({ user: newUser }, { message: 'تم إنشاء المستخدم بنجاح' })
}

// PUT /api/users/[id] - تحديث مستخدم
const handlePut = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.USER_UPDATE)
  if (authResult) return authResult

  const { user: currentUser } = request as any
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('id')

  if (!userId) {
    return errorResponse('BAD_REQUEST', 'معرف المستخدم مطلوب')
  }

  const body = await request.json()
  const validatedData = updateUserRequestSchema.parse(body)

  // التحقق من وجود المستخدم
  const existingUser = await prisma.user.findUnique({
    where: { id: userId }
  })

  if (!existingUser) {
    return notFoundResponse('المستخدم')
  }

  // التحقق من الصلاحيات
  // المستخدم لا يمكنه رفع نفسه لصلاحية أعلى
  if (userId === currentUser.userId && validatedData.role && validatedData.role !== existingUser.role) {
    return forbiddenResponse('لا يمكنك تغيير دورك بنفسك')
  }

  // SUPER_ADMIN لا يمكن تعديله إلا من SUPER_ADMIN آخر
  if (existingUser.adminLevel === 'SUPER_ADMIN' && currentUser.adminLevel !== 'SUPER_ADMIN') {
    return forbiddenResponse('لا يمكن تعديل حسابات المشرفين الأعلى')
  }

  // إعداد بيانات التحديث
  const updateData: any = {}

  if (validatedData.firstName !== undefined) updateData.firstName = validatedData.firstName
  if (validatedData.lastName !== undefined) updateData.lastName = validatedData.lastName
  if (validatedData.name !== undefined) updateData.name = validatedData.name
  if (validatedData.phone !== undefined) updateData.phone = encrypt(validatedData.phone)
  if (validatedData.isActive !== undefined) updateData.isActive = validatedData.isActive

  // تغيير الدور (للـ SUPER_ADMIN و ADMIN فقط)
  if (validatedData.role !== undefined && validatedData.role !== (existingUser.role as string)) {
    if (currentUser.adminLevel !== 'SUPER_ADMIN' && currentUser.adminLevel !== 'SYSTEM_ADMIN') {
      return forbiddenResponse('لا يمكنك تغيير أدوار المستخدمين')
    }
    updateData.role = validatedData.role
  }

  if ((validatedData as any).adminLevel !== undefined) {
    if (currentUser.adminLevel !== 'SUPER_ADMIN') {
      return forbiddenResponse('لا يمكنك تغيير مستويات المشرفين')
    }
    updateData.adminLevel = (validatedData as any).adminLevel
  }

  // تحديث كلمة المرور
  if (validatedData.password !== undefined) {
    updateData.password = await hashPassword(validatedData.password)

    // إبطال جميع الجلسات عند تغيير كلمة المرور
    await prisma.sessionLog.updateMany({
      where: { userId, logoutAt: null },
      data: { logoutAt: new Date() }
    })
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      updatedAt: true,
    }
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: currentUser.userId,
    action: 'USER_UPDATED' as AuditAction,
    resource: 'user',
    resourceId: userId,
    details: {
      changes: Object.keys(updateData),
      targetRole: updatedUser.role
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({ user: updatedUser }, { message: 'تم تحديث المستخدم بنجاح' })
}

// DELETE /api/users/[id] - حذف مستخدم
const handleDelete = async (request: NextRequest): Promise<NextResponse> => {
  const authResult = await requireAuth(request, PermissionType.USER_DELETE)
  if (authResult) return authResult

  const { user: currentUser } = request as any
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('id')

  if (!userId) {
    return errorResponse('BAD_REQUEST', 'معرف المستخدم مطلوب')
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId }
  })

  if (!existingUser) {
    return notFoundResponse('المستخدم')
  }

  // لا يمكن للمستخدم حذف نفسه
  if (userId === currentUser.userId) {
    return errorResponse('BAD_REQUEST', 'لا يمكنك حذف حسابك بنفسك')
  }

  // SUPER_ADMIN لا يمكن حذفه
  if (existingUser.adminLevel === 'SUPER_ADMIN') {
    return forbiddenResponse('لا يمكن حذف حسابات المشرفين الأعلى')
  }

  // حذف المستخدم (أو تعطيله حسب السياسة)
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false }
  })

  // إبطال جميع الجلسات
  await prisma.sessionLog.updateMany({
    where: { userId, logoutAt: null },
    data: { logoutAt: new Date() }
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: currentUser.userId,
    action: 'USER_DELETED' as AuditAction,
    resource: 'user',
    resourceId: userId,
    details: {
      deletedEmail: existingUser.email,
      deletedRole: existingUser.role
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return successResponse({
    userId,
    message: 'تم تعطيل المستخدم بنجاح (لم يتم الحذف النهائي)'
  }, { message: 'تم تعطيل المستخدم بنجاح' })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/users' })
export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/users' })
export const PUT = withErrorHandler(handlePut, { method: 'PUT', path: '/api/users' })
export const DELETE = withErrorHandler(handleDelete, { method: 'DELETE', path: '/api/users' })
