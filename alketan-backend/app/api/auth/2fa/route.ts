import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  generate2FASecret,
  generate2FASetupURL,
  generateBackupCodes,
  hashBackupCode,
  verifyTOTPCode,
  createTestSecret,
} from '@/utils/twoFactorAuth'
import { authenticate } from '@/middleware/auth'
import { successResponse, errorResponse, validationProblem, unauthorizedResponse, notFoundResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import { logWarn, logError } from '@/utils/logger'
import { verifyBackupCode } from '@/utils/twoFactorAuth'
import { withErrorHandler } from '@/utils/errorHandler'

// GET: جلب_حالة_2FA_وإعداد_الرؤوس
export const GET = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }

  // جلب_معلومات_2FA_من_قاعدة_البيانات
  const userWith2FA = await prisma.user.findUnique({
    where: { id: user.userId },
    select: {
      twoFactorEnabled: true,
      twoFactorSecret: true,
    }
  })

  if (!userWith2FA) {
    return notFoundResponse('المستخدم')
  }

  // إذا_لم_يكن_2FA_مفعلاً،_إنشاء_رأس_إعداد_جديد
  let setupData = null

  if (!userWith2FA.twoFactorEnabled) {
    const secret = generate2FASecret()
    const setupURL = generate2FASetupURL(
      secret,
      user.email || 'user@example.com',
    )
    const backupCodes = generateBackupCodes(10)

    // حفظ_السر_مؤقتاً
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        twoFactorSecret: secret,
      }
    })

    setupData = {
      secret,
      setupURL,
      backupCodes,
      message: 'احفظ رموز النسخ الاحتياطي في مكان آمن'
    }
  }

  return successResponse({
    twoFactorEnabled: userWith2FA.twoFactorEnabled,
    setupData,
  })
}, { method: 'GET', path: '/api/auth/2fa' })

// POST: تفعيل_أو_التحقق_من_2FA
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json()
  const { action, code } = body

  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }

  if (action === 'verify') {
    // التحقق_من_رمز_2FA_للتفعيل
    if (!code) {
      return validationProblem([{
        field: 'code',
        message: 'رمز التحقق مطلوب'
      }])
    }

    const userWith2FA = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        twoFactorSecret: true,
      }
    })

    if (!userWith2FA?.twoFactorSecret) {
      return errorResponse('BAD_REQUEST', 'لم يتم إنشاء إعداد 2FA')
    }

    // التحقق_من_الرمز
    const isValid = verifyTOTPCode(userWith2FA.twoFactorSecret, code)

    if (!isValid) {
      await createAuditLog({
        userId: user.userId,
        action: '2FA_VERIFICATION_FAILED' as AuditAction,
        resource: 'auth',
        details: { reason: 'invalid_code' },
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined
      })

      return unauthorizedResponse('رمز التحقق غير صحيح')
    }

    // تفعيل_2FA
    const backupCodes = generateBackupCodes(10)
    const hashedBackupCodes = backupCodes.map(hashBackupCode)

    await prisma.user.update({
      where: { id: user.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
      }
    })

    await createAuditLog({
      userId: user.userId,
      action: '2FA_ENABLED' as AuditAction,
      resource: 'auth',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    })

    return successResponse({
      message: 'تم تفعيل المصادقة الثنائية بنجاح',
      backupCodes,
      warning: 'احفظ رموز النسخ الاحتياطي في مكان آمن. يمكنك استخدامها إذا فقدت الوصول إلى تطبيق المصادقة'
    })

  } else if (action === 'disable') {
    // تعطيل_2FA
    if (!code) {
      return validationProblem([{
        field: 'code',
        message: 'رمز التحقق مطلوب'
      }])
    }

    const userWith2FA = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      }
    })

    if (!userWith2FA?.twoFactorEnabled) {
      return errorResponse('BAD_REQUEST', 'المصادقة الثنائية غير مفعلة')
    }

    // محاولة_التحقق_بالرمز_أو_رمز_النسخ_الاحتياطي
    let isValid = false
    let usedBackupCodeIndex = -1

    // التحقق_كـرمز_عادي
    if (userWith2FA.twoFactorSecret) {
      isValid = verifyTOTPCode(userWith2FA.twoFactorSecret, code)
    }

    // التحقق_كـرمز_نسخ_احتياطي
    if (!isValid && userWith2FA.twoFactorBackupCodes) {
      try {
        const hashedCodes = JSON.parse(userWith2FA.twoFactorBackupCodes) as string[]
        const backupResult = verifyBackupCode(code, hashedCodes)

        if (backupResult.valid) {
          isValid = true
          usedBackupCodeIndex = backupResult.index

          // إزالة_رمز_النسخ_الاحتياطي_المستخدم
          hashedCodes.splice(usedBackupCodeIndex, 1)

          await prisma.user.update({
            where: { id: user.userId },
            data: {
              twoFactorBackupCodes: JSON.stringify(hashedCodes),
            }
          })
        }
      } catch (e) {
        logError('Error parsing backup codes', { error: e })
      }
    }

    if (!isValid) {
      await createAuditLog({
        userId: user.userId,
        action: '2FA_DISABLE_FAILED' as AuditAction,
        resource: 'auth',
        details: { reason: 'invalid_code' },
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined
      })

      return unauthorizedResponse('رمز التحقق غير صحيح')
    }

    // تعطيل_2FA
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      }
    })

    await createAuditLog({
      userId: user.userId,
      action: '2FA_DISABLED' as AuditAction,
      resource: 'auth',
      details: usedBackupCodeIndex >= 0 ? { usedBackupCode: true } : {},
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined
    })

    return successResponse({
      message: 'تم تعطيل المصادقة الثنائية بنجاح',
    })

  } else if (action === 'test') {
    // اختبار_الـ_2FA_للـ_تطوير
    const testData = createTestSecret()

    return successResponse({
      secret: testData.secret,
      currentCodes: testData.codes,
      message: 'هذه الرموز للاختبار فقط. لا تستخدمها في الإنتاج'
    })

  } else {
    return errorResponse('BAD_REQUEST', 'إجراء غير صالح')
  }
}, { method: 'POST', path: '/api/auth/2fa' })
