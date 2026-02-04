import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateAccessToken, generateSessionId } from '@/utils/auth'
import { registerSchema } from '@/utils/validation'
import {
  validatePassword,
  isCommonPassword,
  containsPersonalInfo,
  DEFAULT_PASSWORD_REQUIREMENTS,
} from '@/utils/passwordValidation'
import { successResponse, errorResponse, validationProblem, conflictResponse, createdResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { withErrorHandler } from '@/utils/errorHandler'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json()

  // التحقق من صحة البيانات الأساسية
  const validatedData = registerSchema.parse(body)

  // التحقق من قوة كلمة المرور
  const passwordValidation = validatePassword(validatedData.password, DEFAULT_PASSWORD_REQUIREMENTS)

  if (!passwordValidation.isValid) {
    return validationProblem(
      passwordValidation.errors.map(err => ({
        field: 'password',
        message: err
      }))
    )
  }

  // التحقق من كلمة المرور الشائعة
  if (isCommonPassword(validatedData.password)) {
    return validationProblem([{
      field: 'password',
      message: 'هذه كلمة المرور شائعة جداً، يرجى اختيار كلمة مرور أخرى'
    }])
  }

  // التحقق من عدم احتواء كلمة المرور على معلومات شخصية
  if (containsPersonalInfo(validatedData.password, {
    firstName: validatedData.firstName,
    lastName: validatedData.lastName,
    email: validatedData.email,
    phone: validatedData.phone
  })) {
    return validationProblem([{
      field: 'password',
      message: 'لا يجوز أن تحتوي كلمة المرور على معلوماتك الشخصية'
    }])
  }

  // التحقق من وجود المستخدم
  const existingUser = await prisma.user.findUnique({
    where: { email: validatedData.email },
  })

  if (existingUser) {
    return conflictResponse('البريد الإلكتروني مستخدم بالفعل')
  }

  // تشفير كلمة المرور
  const hashedPassword = await hashPassword(validatedData.password)

  // إنشاء المستخدم
  const user = await prisma.user.create({
    data: {
      email: validatedData.email,
      password: hashedPassword,
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      name: validatedData.name || `${validatedData.firstName} ${validatedData.lastName}`,
      phone: validatedData.phone,
      role: validatedData.role || 'USER',
      adminLevel: validatedData.adminLevel || null,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true,
      phone: true,
      role: true,
      adminLevel: true,
      createdAt: true,
    },
  })

  // إنشاء sessionId جديد للمستخدم الجديد
  const newSessionId = generateSessionId()

  // إنشاء token
  const token = generateAccessToken(user.id, user.role, user.adminLevel as any)

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.id,
    action: 'USER_CREATED' as AuditAction,
    resource: 'auth',
    details: {
      email: user.email,
      role: user.role,
      action: 'USER_REGISTERED'
    },
    ipAddress: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined
  })

  return createdResponse({
    user,
    token,
  }, { message: 'تم التسجيل بنجاح' })
}, { method: 'POST', path: '/api/auth/register' })
