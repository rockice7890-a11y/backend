import { NextRequest } from 'next/server'

// دوال متوافقة مع Edge Runtime لتوليد fingerprints آمنة
function createHash(data: string): string {
  // استخدام require لتجنب التحميل في Edge Runtime
  const cryptoModule = require('crypto')
  return cryptoModule.createHash('sha256').update(data).digest('hex')
}

function generateRandomBytes(size: number): string {
  if (typeof window !== 'undefined') {
    // للمتصفح - استخدام Web Crypto API
    const bytes = new Uint8Array(size)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  // للخادم
  const cryptoModule = require('crypto')
  return cryptoModule.randomBytes(size).toString('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  try {
    const cryptoModule = require('crypto')
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    
    if (bufA.length !== bufB.length) return false
    
    return cryptoModule.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

export interface DeviceFingerprint {
  fingerprint: string
  components: {
    userAgent: string
    acceptLanguage: string
    timezone: string
    platform: string
    screenResolution?: string
    colorDepth?: string
  }
}

/**
 * إنشاء Device Fingerprint فريد للمستخدم
 * يستخدم خصائص الجهاز والمتصفح لإنشاء بصمة فريدة
 */
export function generateDeviceFingerprint(request: NextRequest, userAgent: string): DeviceFingerprint {
  const acceptLanguage = request.headers.get('accept-language') || ''
  const timezone = request.headers.get('x-timezone') || 'unknown'
  
  // استخراج معلومات المنصة من User-Agent
  let platform = 'Unknown'
  if (/Windows/.test(userAgent)) platform = 'Windows'
  else if (/Macintosh|Mac OS/.test(userAgent)) platform = 'macOS'
  else if (/Linux/.test(userAgent)) platform = 'Linux'
  else if (/Android/.test(userAgent)) platform = 'Android'
  else if (/iPhone|iPad|iPod/.test(userAgent)) platform = 'iOS'
  
  // إنشاء المكونات - نستخدم فقط المعلومات المتاحة من الـ request
  const components = {
    userAgent: sanitizeComponent(userAgent),
    acceptLanguage: sanitizeComponent(acceptLanguage.split(',')[0] || ''),
    timezone: sanitizeComponent(timezone),
    platform: platform
  }

  // إنشاء fingerprint فريد من المكونات
  const fingerprintString = Object.values(components).join('|')
  const fingerprint = createHash(fingerprintString)

  return {
    fingerprint,
    components
  }
}

/**
 * إنشاء Device Fingerprint من معلومات Client-side
 * يستخدم في الـ frontend JavaScript
 */
export function createClientFingerprint(data: {
  userAgent: string
  language: string
  timezone: string
  platform: string
  screenResolution: string
  colorDepth: string
}): DeviceFingerprint {
  const components = {
    userAgent: sanitizeComponent(data.userAgent),
    acceptLanguage: sanitizeComponent(data.language),
    timezone: sanitizeComponent(data.timezone),
    platform: data.platform,
    screenResolution: sanitizeComponent(data.screenResolution),
    colorDepth: sanitizeComponent(data.colorDepth)
  }

  const fingerprintString = Object.values(components).join('|')
  const fingerprint = createHash(fingerprintString)

  return {
    fingerprint,
    components
  }
}

/**
 * تنظيف وإزالة الأحرف الخاصة من المكونات
 */
function sanitizeComponent(value: string): string {
  // إزالة الأحرف الخاصة والتهريب
  return value
    .replace(/[^a-zA-Z0-9\-_.]/g, '')
    .substring(0, 200)
    .trim()
    .toLowerCase()
}

/**
 * التحقق من تطابق البصمات
 */
export function verifyFingerprint(
  storedFingerprint: string | null,
  currentFingerprint: string
): boolean {
  if (!storedFingerprint) return true // لا يوجد fingerprint قديم، السماح
  
  // مقارنة آمنة باستخدام timing-safe-equal
  try {
    const stored = Buffer.from(storedFingerprint, 'hex')
    const current = Buffer.from(currentFingerprint, 'hex')
    
    if (stored.length !== current.length) return false
    
    return timingSafeEqual(storedFingerprint, currentFingerprint)
  } catch {
    return false
  }
}

/**
 * إنشاء معرف جلسة فريد
 */
export function generateSecureSessionId(): string {
  return generateRandomBytes(32)
}

/**
 * إنشاء CSRF Token آمن
 */
export function generateCSRFToken(): string {
  return generateRandomBytes(32)
}

/**
 * التحقق من CSRF Token
 */
export function verifyCSRFToken(token: string, expectedToken: string): boolean {
  if (!token || !expectedToken) return false
  
  try {
    const tokenBuffer = Buffer.from(token, 'hex')
    const expectedBuffer = Buffer.from(expectedToken, 'hex')
    
    if (tokenBuffer.length !== expectedBuffer.length) return false
    
    return timingSafeEqual(token, expectedToken)
  } catch {
    return false
  }
}
