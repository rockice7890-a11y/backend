import { NextResponse } from 'next/server'

// RFC 7807 Problem Details interface
export interface ProblemDetail {
  type: string
  title: string
  status: number
  detail: string
  instance?: string
  errorId?: string
  timestamp?: string
  [key: string]: any
}

// رموز الاستجابة الموحدة - موسعة
export const RESPONSE_CODES = {
  // نجاح (2xx)
  SUCCESS: 'SUCCESS',
  CREATED: 'CREATED',
  NO_CONTENT: 'NO_CONTENT',
  ACTION_REQUIRED: 'ACTION_REQUIRED',

  // خطأ عميل (4xx)
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  OPTIMISTIC_LOCK_ERROR: 'OPTIMISTIC_LOCK_ERROR',

  // خطأ خادم (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  REDIS_ERROR: 'REDIS_ERROR',

  // أخطاء الأعمال
  BOOKING_NOT_AVAILABLE: 'BOOKING_NOT_AVAILABLE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_FAILED: 'REFUND_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
} as const

export type ResponseCode = typeof RESPONSE_CODES[keyof typeof RESPONSE_CODES]

// واجهة الاستجابة الموحدة
export interface ApiResponse<T = any> {
  success: boolean
  code: ResponseCode
  message?: string
  data?: T
  errors?: ValidationError[]
  meta?: {
    timestamp: string
    requestId: string
    pagination?: PaginationMeta
    rateLimit?: RateLimitInfo
  }
}

// أخطاء التحقق
export interface ValidationError {
  field: string
  message: string
  value?: any
}

// معلومات Pagination
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

// معلومات Rate Limit
export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: Date
}

// الحصول على كود الحالة من رمز الخطأ
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

  return statusMap[code] || 400
}

// إنشاء استجابة ناجحة
export function successResponse<T>(
  data: T,
  options?: {
    message?: string
    code?: ResponseCode
    pagination?: PaginationMeta
    requestId?: string
    [key: string]: any
  }
): NextResponse {
  const meta: any = {
    timestamp: new Date().toISOString(),
    requestId: options?.requestId || generateRequestId(),
    pagination: options?.pagination
  }

  // إضافة أي حقول إضافية للميتا
  if (options) {
    Object.entries(options).forEach(([key, value]) => {
      if (!['message', 'code', 'pagination', 'requestId'].includes(key)) {
        meta[key] = value
      }
    })
  }

  return NextResponse.json({
    success: true,
    code: options?.code || RESPONSE_CODES.SUCCESS,
    message: options?.message || 'تم تنفيذ العملية بنجاح',
    data,
    meta
  }, { status: 200 })
}

// إنشاء استجابة خطأ موحدة
export function errorResponse(
  code: ResponseCode,
  message: string,
  options?: {
    status?: number
    errors?: ValidationError[]
    requestId?: string
    details?: Record<string, any>
    errorId?: string
  }
): NextResponse {
  const errorId = options?.errorId || generateErrorId()

  return NextResponse.json({
    success: false,
    code,
    message,
    ...(options?.errors && { errors: options.errors }),
    ...(options?.details && { details: options.details }),
    meta: {
      timestamp: new Date().toISOString(),
      requestId: options?.requestId || generateRequestId(),
      errorId
    }
  }, { 
    status: options?.status || getStatusFromCode(code),
    headers: {
      'X-Error-Code': code,
      'X-Error-ID': errorId,
    }
  })
}

// استجابة تم الإنشاء بنجاح
export function createdResponse<T>(
  data: T,
  options?: {
    message?: string
    requestId?: string
  }
): NextResponse {
  return successResponse(data, {
    message: options?.message || 'تم الإنشاء بنجاح',
    code: RESPONSE_CODES.CREATED,
    requestId: options?.requestId
  })
}

// استجابة عدم الصلاحية
export function unauthorizedResponse(
  message: string = 'غير مصرح لك',
  code: ResponseCode = RESPONSE_CODES.UNAUTHORIZED
): NextResponse {
  return errorResponse(code, message, { status: 401 })
}

// استجابة عدم الإذن
export function forbiddenResponse(
  message: string = 'ليس لديك صلاحية للوصول لهذا المورد'
): NextResponse {
  return errorResponse(RESPONSE_CODES.FORBIDDEN, message, { status: 403 })
}

// استجابة غير موجود
export function notFoundResponse(
  resource: string = 'المورد'
): NextResponse {
  return errorResponse(
    RESPONSE_CODES.NOT_FOUND,
    `${resource} غير موجود`,
    { status: 404 }
  )
}

// استجابة تعارض
export function conflictResponse(
  message: string = 'تعارض في البيانات',
  options?: {
    details?: Record<string, any>
  }
): NextResponse {
  return errorResponse(RESPONSE_CODES.CONFLICT, message, { 
    status: 409,
    ...options
  })
}

// استجابة Rate Limit
export function rateLimitResponse(
  retryAfter: number,
  limit: number
): NextResponse {
  const response = errorResponse(RESPONSE_CODES.RATE_LIMITED, 'تم تجاوز الحد المسموح', {
    status: 429
  })

  response.headers.set('Retry-After', retryAfter.toString())
  response.headers.set('X-RateLimit-Limit', limit.toString())

  return response
}

// استجابة خطأ داخلي
export function internalErrorResponse(
  message: string = 'حدث خطأ داخلي',
  requestId?: string
): NextResponse {
  const errorId = generateErrorId()
  console.error(`Internal Error [${errorId}]:`, message)

  return errorResponse(RESPONSE_CODES.INTERNAL_ERROR, message, {
    status: 500,
    requestId,
    errorId
  })
}

// استجابة خطأ التحقق من الصحة
export function validationErrorResponse(
  message: string = 'بيانات غير صحيحة',
  errors?: Array<{ field: string; message: string; value?: any }>,
  requestId?: string
): NextResponse {
  return errorResponse(RESPONSE_CODES.VALIDATION_ERROR, message, {
    status: 400,
    errors,
    requestId
  })
}

// إنشاء Pagination Meta
export function createPaginationMeta(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit)

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  }
}

// إنشاء استجابة مع Pagination
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  options?: {
    message?: string
    requestId?: string
    [key: string]: any
  }
): NextResponse {
  const pagination = createPaginationMeta(page, limit, total)

  return successResponse(data, {
    message: options?.message || `تم العثور على ${total} عنصر`,
    pagination,
    requestId: options?.requestId,
    ...options
  })
}

// RFC 7807 Problem Details
export function problemResponse(
  status: number,
  title: string,
  detail: string,
  options?: {
    type?: string
    instance?: string
    additionalFields?: Record<string, any>
    errorId?: string
    [key: string]: any
  }
): NextResponse {
  const errorId = options?.errorId || generateErrorId()
  
  const problem: ProblemDetail = {
    type: options?.type || `https://api.alketan.com/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
    title,
    status,
    detail,
    instance: options?.instance,
    errorId,
    timestamp: new Date().toISOString()
  }

  // إضافة حقول إضافية إذا وجدت
  if (options?.additionalFields) {
    Object.assign(problem, options.additionalFields)
  }

  return NextResponse.json(problem, {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Error-ID': errorId
    }
  })
}

// استجابة مشكلة غير مصرح (401)
export function unauthorizedProblem(
  detail: string = 'يجب تسجيل الدخول للوصول لهذا المورد'
): NextResponse {
  return problemResponse(401, 'Unauthorized', detail, {
    type: 'https://api.alketan.com/errors/unauthorized'
  })
}

// استجابة مشكلة محظور (403)
export function forbiddenProblem(
  detail: string = 'ليس لديك الصلاحيات الكافية'
): NextResponse {
  return problemResponse(403, 'Forbidden', detail, {
    type: 'https://api.alketan.com/errors/forbidden'
  })
}

// استجابة مشكلة غير موجود (404)
export function notFoundProblem(
  resource: string = 'المورد',
  detail?: string
): NextResponse {
  return problemResponse(404, 'Not Found', detail || `${resource} غير موجود`, {
    type: 'https://api.alketan.com/errors/not-found'
  })
}

// استجابة مشكلة التعارض (409) - للحجوزات المتزامنة
export function conflictProblem(
  detail: string = 'تعارض في البيانات، قد يكون المورد مُعدَّل من مستخدم آخر',
  options?: {
    details?: Record<string, any>
  }
): NextResponse {
  return problemResponse(409, 'Conflict', detail, {
    type: 'https://api.alketan.com/errors/conflict',
    additionalFields: options?.details
  })
}

// استجابة مشكلة التحقق من الصحة (422)
export function validationProblem(
  errors: Array<{ field: string; message: string; value?: any }>,
  detail: string = 'بيانات غير صحيحة'
): NextResponse {
  return problemResponse(422, 'Unprocessable Entity', detail, {
    type: 'https://api.alketan.com/errors/validation',
    errors
  })
}

// استجابة مشكلة Rate Limit (429)
export function rateLimitProblem(
  retryAfter: number = 60,
  limit: number = 100
): NextResponse {
  const response = problemResponse(429, 'Too Many Requests',
    'تم تجاوز الحد المسموح من الطلبات', {
    type: 'https://api.alketan.com/errors/rate-limit',
    additionalFields: {
      retryAfter,
      limit
    }
  })

  response.headers.set('Retry-After', retryAfter.toString())
  return response
}

// استجابة مشكلة خطأ خادم (500)
export function internalErrorProblem(
  detail: string = 'حدث خطأ غير متوقع في الخادم',
  requestId?: string
): NextResponse {
  return problemResponse(500, 'Internal Server Error', detail, {
    type: 'https://api.alketan.com/errors/internal-server-error',
    requestId
  })
}

// استجابة للعمليات التي تتطلب إجراءً إضافياً
export function actionRequiredResponse(
  action: string,
  message: string,
  options?: {
    details?: Record<string, any>
  }
): NextResponse {
  return NextResponse.json({
    success: true,
    code: RESPONSE_CODES.ACTION_REQUIRED,
    actionRequired: action,
    message,
    ...(options?.details && { details: options.details }),
    meta: {
      timestamp: new Date().toISOString(),
      requestId: generateRequestId()
    }
  }, { status: 200 })
}

// Helper للحصول على Request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Helper للحصول على Error ID
function generateErrorId(): string {
  return `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`
}
