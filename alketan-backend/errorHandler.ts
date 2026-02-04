import { NextRequest, NextResponse } from 'next/server'
import { logError, logApiError } from './logger'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { errorResponse, RESPONSE_CODES, ResponseCode } from '@/utils/apiResponse'
import { createAuditLog, AuditAction } from '@/utils/auditLogger'

export interface ApiError {
  code: string
  message: string
  details?: any
  statusCode: number
  errorId?: string
}

// رسائل خطأ آمنة للعرض للمستخدم
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  // أخطاء Prisma
  P2002: 'توجد بيانات مشابهة بالفعل',
  P2014: 'التغيير يتعارض مع علاقة موجودة',
  P2025: 'السجل غير موجود',
  P2003: 'خطأ في المراجع الخارجية',

  // أخطاء JWT
  'jwt expired': 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً',
  'jwt malformed': 'جلسة غير صالحة، يرجى تسجيل الدخول مجدداً',
  'invalid token': 'توكن غير صالح',

  // أخطاء الشبكة
  ECONNREFUSED: 'خدمة غير متاحة حالياً',
  ETIMEDOUT: 'انتهت مهلة الاتصال، يرجى المحاولة لاحقاً',
}

// استخراج رسالة خطأ آمنة
function getSafeErrorMessage(error: Error): string {
  const message = error.message.toLowerCase()
  
  // البحث في الرسائل الآمنة
  for (const [key, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
    if (message.includes(key.toLowerCase())) {
      return safeMessage
    }
  }

  // إذا كان خطأ Zod
  if (error instanceof ZodError) {
    return 'بيانات غير صحيحة، يرجى التحقق من المدخلات'
  }

  // إذا كان خطأ Prisma
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = handlePrismaError(error)
    return prismaError.message
  }

  // إذا كانت رسالة قصيرة ومناسبة
  if (message.length < 100 && !message.includes('stack')) {
    return error.message
  }

  return 'حدث خطأ، يرجى المحاولة مرة أخرى'
}

// تحديد رمز الخطأ المناسب
function getErrorCode(error: Error): ResponseCode {
  const message = error.message.toLowerCase()

  // أخطاء قاعدة البيانات
  if (message.includes('prisma') || message.includes('database')) {
    if (message.includes('p2002')) return RESPONSE_CODES.DUPLICATE_ENTRY
    if (message.includes('p2025') || message.includes('not found')) return RESPONSE_CODES.NOT_FOUND
    return RESPONSE_CODES.DATABASE_ERROR
  }

  // أخطاء JWT
  if (message.includes('jwt') || message.includes('token')) {
    if (message.includes('expired')) return RESPONSE_CODES.TOKEN_EXPIRED
    if (message.includes('invalid') || message.includes('malformed')) return RESPONSE_CODES.TOKEN_INVALID
    return RESPONSE_CODES.UNAUTHORIZED
  }

  // أخطاء Zod
  if (error instanceof ZodError) {
    return RESPONSE_CODES.VALIDATION_ERROR
  }

  // أخطاء Redis
  if (message.includes('redis') || message.includes('econnrefused')) {
    return RESPONSE_CODES.REDIS_ERROR
  }

  // أخطاء.timeout
  if (message.includes('timeout') || message.includes('etimedout')) {
    return RESPONSE_CODES.TIMEOUT
  }

  return RESPONSE_CODES.INTERNAL_ERROR
}

/**
 * معالج الأخطاء المركزي - نسخة محسنة
 */
export class AppError extends Error {
  statusCode: number
  code: string
  details?: any
  errorId?: string
  isOperational: boolean

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: any,
    isOperational: boolean = true
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.isOperational = isOperational
    this.errorId = `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`
    Error.captureStackTrace(this, this.constructor)
  }

  toResponse(): NextResponse {
    return errorResponse(this.code as ResponseCode, this.message, {
      status: this.statusCode,
      details: this.details,
      errorId: this.errorId,
    })
  }
}

/**
 * معالجة الأخطاء وإرجاع Response مناسب
 */
export function handleError(
  error: unknown,
  context?: {
    method?: string
    path?: string
    userId?: string
    request?: NextResponse
  }
): NextResponse {
  // توليد errorId
  const errorId = `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`

  // Zod Validation Error
  if (error instanceof ZodError) {
    const errors = error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }))

    return errorResponse(RESPONSE_CODES.VALIDATION_ERROR, 'بيانات غير صحيحة', {
      status: 422,
      details: { validationErrors: errors },
      errorId,
    })
  }

  // Prisma Errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = handlePrismaError(error)
    return errorResponse(
      prismaError.code as ResponseCode,
      prismaError.message,
      {
        status: prismaError.statusCode,
        details: prismaError.details,
        errorId,
      }
    )
  }

  // AppError (Custom Error)
  if (error instanceof AppError) {
    // تسجيل في Audit Log
    if (context?.userId && context?.path) {
      createAuditLog({
        userId: context.userId,
        action: 'API_ERROR' as AuditAction,
        resource: 'api',
        details: {
          errorId: error.errorId,
          errorCode: error.code,
          path: context.path,
        },
      }).catch(console.error)
    }

    return error.toResponse()
  }

  // Error عادي
  if (error instanceof Error) {
    const errorCode = getErrorCode(error)
    const safeMessage = getSafeErrorMessage(error)

    // Logging
    if (context) {
      logApiError(
        context.method || 'UNKNOWN',
        context.path || 'UNKNOWN',
        error,
        context.userId
      )
    } else {
      logError(`[${errorId}] Unhandled error`, error)
    }

    // في بيئة التطوير، أظهر المزيد من التفاصيل
    if (process.env.NODE_ENV === 'development') {
      return errorResponse(errorCode, error.message, {
        status: 500,
        details: {
          errorId,
          errorName: error.name,
          stack: error.stack,
        },
        errorId,
      })
    }

    // في الإنتاج، أظهر رسالة آمنة فقط
    return errorResponse(errorCode, safeMessage, {
      status: 500,
      errorId,
    })
  }

  // Unknown error
  logError(`[${errorId}] Unknown error:`, error)

  return errorResponse(RESPONSE_CODES.INTERNAL_ERROR, 'حدث خطأ', {
    status: 500,
    errorId,
  })
}

/**
 * معالجة أخطاء Prisma
 */
function handlePrismaError(error: Prisma.PrismaClientKnownRequestError): ApiError {
  const isDev = process.env.NODE_ENV === 'development'

  switch (error.code) {
    case 'P2002':
      return {
        code: 'UNIQUE_CONSTRAINT_VIOLATION',
        message: 'القيمة موجودة بالفعل',
        statusCode: 409,
        details: isDev ? error.message : undefined,
      }
    case 'P2025':
      return {
        code: 'RECORD_NOT_FOUND',
        message: 'السجل غير موجود',
        statusCode: 404,
      }
    case 'P2003':
      return {
        code: 'FOREIGN_KEY_CONSTRAINT',
        message: 'خطأ في المراجع الخارجية',
        statusCode: 400,
        details: isDev ? error.message : undefined,
      }
    case 'P2014':
      return {
        code: 'REQUIRED_RELATION_MISSING',
        message: 'العلاقة المطلوبة مفقودة',
        statusCode: 400,
      }
    case 'P2016':
      return {
        code: 'QUERY_INTERPRETATION_ERROR',
        message: 'خطأ في استعلام قاعدة البيانات',
        statusCode: 400,
      }
    default:
      return {
        code: 'DATABASE_ERROR',
        message: 'حدث خطأ في قاعدة البيانات',
        statusCode: 500,
        details: isDev ? error.message : undefined,
      }
  }
}

/**
 * Wrapper للـ API Routes مع Error Handling
 */
export function withErrorHandler(
  handler: (request: NextRequest, context?: any) => Promise<NextResponse>,
  context?: { method?: string; path?: string }
) {
  return async (request: NextRequest, params?: any) => {
    try {
      return await handler(request, params)
    } catch (error) {
      return handleError(error, {
        method: context?.method || request.method,
        path: context?.path || new URL(request.url).pathname,
      })
    }
  }
}

/**
 * معالج أخطاء Async
 */
export async function handleAsyncError<T>(
  promise: Promise<T>,
  errorHandler?: (error: Error) => T
): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof Error && errorHandler) {
      return errorHandler(error)
    }
    throw error
  }
}

/**
 * إنشاء خطأ عمليات (Operational Error)
 */
export class OperationalError extends AppError {
  constructor(
    code: ResponseCode,
    message: string,
    details?: any
  ) {
    super(message, getStatusFromCode(code), code, details, true)
    this.name = 'OperationalError'
  }
}

/**
 * إنشاء خطأ برمجي (Programming Error)
 */
export class ProgrammingError extends AppError {
  constructor(message: string, stack?: string) {
    super('حدث خطأ في النظام', 500, RESPONSE_CODES.INTERNAL_ERROR, {
      message,
      ...(stack && { stack }),
    }, false)
    this.name = 'ProgrammingError'
  }
}

// الحصول على كود الحالة
function getStatusFromCode(code: ResponseCode): number {
  const statusMap: Record<ResponseCode, number> = {
    SUCCESS: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    ACTION_REQUIRED: 200,
    BAD_REQUEST: 400,
    VALIDATION_ERROR: 422,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    VALIDATION_FAILED: 400,
    DUPLICATE_ENTRY: 409,
    TWO_FACTOR_REQUIRED: 200,
    OPTIMISTIC_LOCK_ERROR: 409,
    INTERNAL_ERROR: 500,
    DATABASE_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
    TIMEOUT: 504,
    REDIS_ERROR: 503,
    BOOKING_NOT_AVAILABLE: 409,
    PAYMENT_FAILED: 400,
    REFUND_FAILED: 400,
    ACCOUNT_LOCKED: 423,
    ACCOUNT_DISABLED: 403,
    TOKEN_EXPIRED: 401,
    TOKEN_INVALID: 401,
  }

  return statusMap[code] || 500
}
