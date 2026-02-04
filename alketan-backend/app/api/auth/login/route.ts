import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyPassword,
  generateTokenPair,
  generateSessionId,
  extractDeviceInfo,
  generateDeviceFingerprint,
  decodeRefreshToken
} from '@/utils/auth'
import { verifyTOTPCode, verifyBackupCode } from '@/utils/twoFactorAuth'
import { loginSchema } from '@/utils/validation'
import { logWarn, logError } from '@/utils/logger'
import { successResponse, errorResponse, validationProblem, unauthorizedResponse, forbiddenResponse } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'
import {
  createSession,
  createRefreshToken,
  deleteAllUserSessions,
  getUserSessions
} from '@/lib/sessions'
import { checkRedisConnection } from '@/lib/redis'
import { withErrorHandler } from '@/utils/errorHandler'

// إعدادات الحماية من محاولات تسجيل الدخول
const LOGIN_ATTEMPTS_CONFIG = {
  MAX_ATTEMPTS: 5,
  LOCK_DURATION: 15 * 60 * 1000,
  RESET_WINDOW: 24 * 60 * 60 * 1000,
}

// التحقق من حالة الحظر
async function checkLockStatus(user: any) {
  const now = new Date()

  if (user.lockoutUntil === undefined || user.lockoutUntil === null) {
    return { isLocked: false }
  }

  if (user.lockoutUntil && user.lockoutUntil > now) {
    const remainingTime = Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / 1000 / 60)
    return {
      isLocked: true,
      lockUntil: user.lockoutUntil,
      remainingTime,
      reason: 'تجاوز عدد المحاولات المسموحة'
    }
  }

  if (user.lockoutUntil && user.lockoutUntil <= now) {
    await resetFailedAttempts(user.id)
  }

  return { isLocked: false }
}

// تحديث عداد المحاولات الفاشلة
async function updateFailedAttempts(userId: string, ip: string) {
  try {
    const now = new Date()

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        failedLoginAttempts: true,
        lockoutUntil: true,
        lastFailedLogin: true
      }
    })

    if (!user) return

    const shouldReset = !user.lastFailedLogin ||
      (now.getTime() - user.lastFailedLogin.getTime()) > LOGIN_ATTEMPTS_CONFIG.RESET_WINDOW

    const newAttempts = shouldReset ? 1 : (user.failedLoginAttempts || 0) + 1
    const shouldLock = newAttempts >= LOGIN_ATTEMPTS_CONFIG.MAX_ATTEMPTS

    const updateData: any = {
      failedLoginAttempts: newAttempts,
      lastFailedLogin: now,
    }

    if (shouldLock) {
      updateData.lockoutUntil = new Date(now.getTime() + LOGIN_ATTEMPTS_CONFIG.LOCK_DURATION)
      logWarn(`Account locked for user ${userId} due to too many failed login attempts`, {
        userId,
        attempts: newAttempts,
        ipAddress: ip
      })
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    })

    // تسجيل في التدقيق
    await createAuditLog({
      userId,
      action: (shouldLock ? 'ACCOUNT_LOCKED' : 'FAILED_LOGIN_ATTEMPT') as AuditAction,
      resource: 'auth',
      details: {
        attempts: newAttempts,
        locked: shouldLock,
        ipAddress: ip
      },
      ipAddress: ip,
    })

  } catch (error) {
    logError('Failed to update failed attempts', { error, userId })
  }
}

// إعادة تعيين عداد المحاولات الفاشلة
async function resetFailedAttempts(userId: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastFailedLogin: null,
      }
    })
  } catch (error) {
    logError('Failed to reset failed attempts', { error, userId })
  }
}

// تسجيل محاولات تسجيل الدخول الفاشلة (للمستخدمين غير الموجودين)
async function logFailedAttempt(email: string, ip: string) {
  try {
    await createAuditLog({
      action: 'FAILED_LOGIN_UNKNOWN_USER' as AuditAction,
      resource: 'auth',
      details: { email, reason: 'user_not_found' },
      ipAddress: ip,
    })
  } catch (error) {
    logError('Failed to log unknown user attempt', { error, email, ip })
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json()

  // التحقق من صحة البيانات
  const validatedData = loginSchema.parse(body)

  // استخراج معلومات الجهاز
  const deviceInfo = extractDeviceInfo(request)

  // البحث عن المستخدم
  let user
  try {
    user = await prisma.user.findUnique({
      where: { email: validatedData.email },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        name: true,
        phone: true,
        avatar: true,
        role: true,
        adminLevel: true,
        isActive: true,
        failedLoginAttempts: true,
        lockoutUntil: true,
        lastFailedLogin: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      }
    })
  } catch (error: any) {
    if (error.code === 'P2022') {
      user = await prisma.user.findUnique({
        where: { email: validatedData.email },
        select: {
          id: true,
          email: true,
          password: true,
          firstName: true,
          lastName: true,
          name: true,
          phone: true,
          avatar: true,
          role: true,
          adminLevel: true,
          isActive: true,
          twoFactorEnabled: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
        }
      })

      if (user) {
        (user as any).failedLoginAttempts = 0
          ; (user as any).lockoutUntil = null
          ; (user as any).lastFailedLogin = null
          ; (user as any).twoFactorSecret = null
          ; (user as any).twoFactorBackupCodes = null
      }
    } else {
      throw error
    }
  }

  if (!user) {
    await logFailedAttempt(validatedData.email, deviceInfo.ip)
    return unauthorizedResponse('البريد الإلكتروني أو كلمة المرور غير صحيحة')
  }

  // التحقق من حالة المستخدم
  if (!user.isActive) {
    return forbiddenResponse('حسابك معطل، يرجى التواصل مع الإدارة')
  }

  // التحقق من الحظر
  const lockStatus = await checkLockStatus(user)
  if (lockStatus.isLocked) {
    return errorResponse('RATE_LIMITED',
      `حسابك محظور مؤقتاً بسبب محاولات تسجيل دخول فاشلة متعددة`
    )
  }

  // التحقق من كلمة المرور
  const isPasswordValid = await verifyPassword(validatedData.password, user.password)

  if (!isPasswordValid) {
    await updateFailedAttempts(user.id, deviceInfo.ip)
    return unauthorizedResponse('البريد الإلكتروني أو كلمة المرور غير صحيحة')
  }

  // إعادة تعيين عداد المحاولات الفاشلة
  await resetFailedAttempts(user.id)

  // ✅ التحقق من المصادقة الثنائية (إذا كانت مفعلة)
  if (user.twoFactorEnabled) {
    const twoFactorCode = body.twoFactorCode

    if (!twoFactorCode) {
      return successResponse({
        twoFactorRequired: true
      }, { message: 'يرجى إدخال رمز التحقق الثنائي' })
    }

    // محاولة التحقق بالرمز العادي أو رمز النسخ الاحتياطي
    let is2FAValid = false
    let usedBackupCodeIndex = -1

    // التحقق بالرمز العادي
    if (user.twoFactorSecret) {
      is2FAValid = verifyTOTPCode(user.twoFactorSecret, twoFactorCode)
    }

    // التحقق برمز النسخ الاحتياطي
    if (!is2FAValid && user.twoFactorBackupCodes) {
      try {
        const hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[]
        const backupResult = verifyBackupCode(twoFactorCode, hashedCodes)

        if (backupResult.valid) {
          is2FAValid = true
          usedBackupCodeIndex = backupResult.index

          // إزالة رمز النسخ الاحتياطي المستخدم
          hashedCodes.splice(usedBackupCodeIndex, 1)

          await prisma.user.update({
            where: { id: user.id },
            data: {
              twoFactorBackupCodes: JSON.stringify(hashedCodes),
            }
          })
        }
      } catch (e) {
        logError('Error parsing backup codes', { error: e })
      }
    }

    if (!is2FAValid) {
      await createAuditLog({
        userId: user.id,
        action: '2FA_LOGIN_FAILED' as AuditAction,
        resource: 'auth',
        details: { reason: 'invalid_2fa_code' },
        ipAddress: deviceInfo.ip,
      })

      return unauthorizedResponse('رمز التحقق الثنائي غير صحيح')
    }

    // تسجيل استخدام 2FA بنجاح
    await createAuditLog({
      userId: user.id,
      action: '2FA_LOGIN_SUCCESS' as AuditAction,
      resource: 'auth',
      details: {
        usedBackupCode: usedBackupCodeIndex >= 0,
      },
      ipAddress: deviceInfo.ip,
    })
  }

  // ✅ نجاح تسجيل الدخول

  // إعادة تعيين عداد المحاولات الفاشلة
  await resetFailedAttempts(user.id)

  // إنشاء Session ID جديد
  const sessionId = generateSessionId()
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const clientFingerprint = generateDeviceFingerprint(request, userAgent)
  
  // إنشاء زوج التوكنات (مع deviceId للتتبع)
  const tokens = generateTokenPair(user.id, user.role, user.adminLevel, clientFingerprint.fingerprint)

  // التحقق من توفر Redis
  const redisAvailable = await checkRedisConnection()

  if (redisAvailable) {
    // إنشاء الجلسة في Redis
    await createSession({
      userId: user.id,
      sessionId,
      role: user.role,
      adminLevel: user.adminLevel,
      email: user.email,
      ipAddress: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      deviceFingerprint: clientFingerprint.fingerprint,
    })

    // إنشاء Refresh Token في Redis
    await createRefreshToken(user.id, sessionId)

    // إبطال جميع الجلسات القديمة في Redis (تدفق واحد فقط)
    const existingSessions = await getUserSessions(user.id)
    for (const existingSession of existingSessions) {
      if (existingSession.sessionId !== sessionId) {
        await deleteAllUserSessions(user.id)
        break
      }
    }
  } else {
    logWarn('Redis not available, falling back to PostgreSQL for sessions')
  }

  // حفظ الجلسة في PostgreSQL (للتدقيق)
  await prisma.sessionLog.create({
    data: {
      userId: user.id,
      token: sessionId,
      ipAddress: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      deviceFingerprint: clientFingerprint.fingerprint,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 أيام
    }
  })

  // إبطال جميع الجلسات القديمة في PostgreSQL
  await prisma.sessionLog.updateMany({
    where: {
      userId: user.id,
      token: { not: sessionId },
      logoutAt: null
    },
    data: {
      logoutAt: new Date()
    }
  })

  // تحديث آخر تسجيل دخول
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  })

  // تسجيل في سجل التدقيق
  await createAuditLog({
    userId: user.id,
    action: 'LOGIN_SUCCESS' as AuditAction,
    resource: 'auth',
    details: {
      deviceType: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      loginMethod: 'password',
      sessionId: sessionId.substring(0, 8) + '...',
      sessionType: redisAvailable ? 'redis' : 'postgresql',
      tokenId: tokens.tokenId,
    },
    ipAddress: deviceInfo.ip,
    userAgent: deviceInfo.userAgent,
  })

  // إنشاء Response
  const isProduction = process.env.NODE_ENV === 'production'

  const response = successResponse({
    message: 'تم تسجيل الدخول بنجاح',
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      adminLevel: user.adminLevel,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    tokenId: tokens.tokenId,
  })

  // تخزين Refresh Token في HttpOnly Cookie
  response.cookies.set('__Secure-refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 أيام
    path: '/',
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
  })

  // تخزين Session ID في HttpOnly Cookie
  response.cookies.set('__Secure-sessionId', sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 أيام
    path: '/',
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
  })

  return response
}, { method: 'POST', path: '/api/auth/login' })
