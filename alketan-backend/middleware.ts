import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { addSecurityHeaders } from './middleware/security'
import { 
  rateLimitMiddleware, 
  getRateLimiterForPath, 
  getRateLimitIdentifier,
  getClientIP 
} from './utils/rateLimit'
import { logRequest } from './utils/logger'
import { corsMiddleware, handleCorsPreflight, applyCorsHeaders } from './utils/cors'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. معالجة طلبات OPTIONS (CORS Preflight) أولاً
  if (request.method === 'OPTIONS') {
    const preflightResponse = handleCorsPreflight(request)
    if (preflightResponse) {
      return preflightResponse
    }
  }

  // 2. التحقق من CORS للطلبات العادية
  const corsError = corsMiddleware(request)
  if (corsError) {
    return corsError
  }

  // تطبيق Security Headers على جميع الطلبات
  let response = NextResponse.next()
  response = addSecurityHeaders(response)
  response = applyCorsHeaders(response, request.headers.get('origin'))

  // Rate Limiting للـ API Routes فقط
  if (pathname.startsWith('/api/')) {
    // تحديد نوع Rate Limiter المناسب للمسار
    const limiter = getRateLimiterForPath(pathname)

    // التحقق من Rate Limit باستخدام المعرف الهجين (User ID + IP)
    const rateLimitResponse = await rateLimitMiddleware(request, limiter)
    if (rateLimitResponse) {
      // تطبيق CORS headers على استجابة Rate Limit
      return applyCorsHeaders(rateLimitResponse, request.headers.get('origin'))
    }

    // Logging للـ API Requests مع معلومات Rate Limit
    const userId = request.headers.get('x-user-id') || 'anonymous'
    const clientIP = getClientIP(request)
    logRequest(request.method, pathname, userId, { ip: clientIP })
  }

  return response
}

// تطبيق Middleware على مسارات محددة
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
