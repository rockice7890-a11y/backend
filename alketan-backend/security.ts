import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * إضافة Security Headers للاستجابات
 */
export function addSecurityHeaders(response: NextResponse): NextResponse {
  // Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
  )

  // X-DNS-Prefetch-Control
  response.headers.set('X-DNS-Prefetch-Control', 'on')

  // Strict-Transport-Security (HSTS)
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  )

  // X-Frame-Options
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')

  // X-Content-Type-Options
  response.headers.set('X-Content-Type-Options', 'nosniff')

  // X-XSS-Protection
  response.headers.set('X-XSS-Protection', '1; mode=block')

  // Referrer-Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions-Policy
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  )

  // X-Powered-By (إزالة)
  response.headers.delete('X-Powered-By')

  return response
}

/**
 * Middleware للـ Security Headers
 */
export function securityMiddleware(request: NextRequest): NextResponse {
  const response = NextResponse.next()
  return addSecurityHeaders(response)
}

