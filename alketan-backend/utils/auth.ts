import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as jose from 'jose'  // مكتبة متوافقة مع Edge Runtime
import { NextRequest } from 'next/server'
import { generateDeviceFingerprint, DeviceFingerprint } from './deviceFingerprint'
import { checkRedisConnection } from '@/lib/redis'

// دالة متوافقة مع Edge Runtime لتوليد bytes عشوائية
function generateSecureRandomBytes(size: number): string {
  if (typeof window !== 'undefined') {
    // للمتصفح - استخدام Web Crypto API
    const bytes = new Uint8Array(size)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  // للخادم - استخدام require لتجنب التحميل في Edge
  const cryptoModule = require('crypto')
  return cryptoModule.randomBytes(size).toString('hex')
}

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production'
const JWT_ISSUER = process.env.JWT_ISSUER || 'alketan-api'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'alketan-users'
const ACCESS_TOKEN_EXPIRES = '15m'  // Access token صلاحيته قصيرة
const REFRESH_TOKEN_EXPIRES = '7d'  // Refresh token لمدة 7 أيام

// إعدادات القائمة السوداء للتوكنات
const BLACKLIST_PREFIX = 'blacklist:'
const BLACKLIST_TTL = 24 * 60 * 60  // 24 ساعة (مدة صلاحية Access Token)

// تحويل المفاتيح لصيغة Edge-compatible
let jwtSecret: Uint8Array | null = null
let jwtRefreshSecret: Uint8Array | null = null

function getJwtSecret(): Uint8Array {
  if (!jwtSecret) {
    jwtSecret = new TextEncoder().encode(JWT_SECRET)
  }
  return jwtSecret
}

function getJwtRefreshSecret(): Uint8Array {
  if (!jwtRefreshSecret) {
    jwtRefreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)
  }
  return jwtRefreshSecret
}

// أنواع البيانات - مبسط ومآمن
export interface TokenPayload {
  userId: string          // معرف المستخدم
  role: string          // دور المستخدم
  adminLevel?: string | null  // مستوى الإدارة (اختياري)
  type: 'access' | 'refresh'  // نوع التوكن
  jti?: string         // معرف فريد للتوكن (يُضاف تلقائياً)
  iat?: number         // وقت الإصدار
  exp?: number         // وقت انتهاء الصلاحية
}

// واجهة مبسطة للـ Access Token (للاستخدام في التطبيق)
export interface AccessTokenData {
  userId: string
  role: string
  adminLevel?: string | null
}

// واجهة الـ Refresh Token مع حماية CSRF
export interface RefreshTokenPayload {
  userId: string
  role: string
  adminLevel?: string | null
  type: 'refresh'
  jti?: string         // معرف التوكن
  csrfToken: string    // حماية CSRF
  deviceId?: string    // معرف الجهاز (اختياري)
}

export interface DeviceInfo {
  userAgent: string
  ip: string
  deviceType: string
  browser: string
  os: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenId: string
  csrfToken: string    // CSRF token للـ Refresh Token
}

// تشفير كلمة المرور
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

// التحقق من كلمة المرور
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// إنشاء Session ID فريد
export function generateSessionId(): string {
  return generateSecureRandomBytes(32)
}

// إنشاء JWT ID فريد
function generateJTI(): string {
  return generateSecureRandomBytes(16)
}

// إنشاء CSRF Token فريد
function generateCSRFToken(): string {
  return generateSecureRandomBytes(32)
}

// إنشاء Access Token - يستخدم jsonwebtoken (يعمل في Node.js runtime)
export function generateAccessToken(userId: string, role: string, adminLevel?: string | null): string {
  const jti = generateJTI()
  const payload: TokenPayload = {
    userId,
    role,
    adminLevel,
    type: 'access',
  }
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
    jwtid: jti,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  })
}

// إنشاء Refresh Token - يستخدم jsonwebtoken (يعمل في Node.js runtime)
export function generateRefreshToken(
  userId: string,
  role: string,
  adminLevel?: string | null,
  deviceId?: string
): string {
  const jti = generateJTI()
  const csrfToken = generateCSRFToken()

  const payload: RefreshTokenPayload = {
    userId,
    role,
    adminLevel,
    type: 'refresh',
    csrfToken,
    deviceId,
  }

  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES,
    jwtid: jti,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  })
}

// إنشاء زوج من التوكنات مع Token Rotation وحماية CSRF
export function generateTokenPair(
  userId: string,
  role: string,
  adminLevel?: string | null,
  deviceId?: string
): TokenPair {
  const accessToken = generateAccessToken(userId, role, adminLevel)
  const refreshToken = generateRefreshToken(userId, role, adminLevel, deviceId)

  // استخراج jti و csrfToken من refresh token
  const decoded = jwt.decode(refreshToken) as { jti: string; csrfToken: string } | null

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60, // 15 دقيقة بالثواني
    tokenId: decoded?.jti || '',
    csrfToken: decoded?.csrfToken || '',
  }
}

// التحقق من Access Token - يستخدم jose (متوافق مع Edge Runtime)
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    // فك تشفير بدون التحقق للحصول على jti أولاً (باستخدام try-catch لأن decodeJwt قد يُلقي خطأ)
    let decodedWithoutVerify: { jti?: string } | null = null
    try {
      decodedWithoutVerify = jose.decodeJwt(token) as { jti?: string } | null
    } catch {
      // التوكن غير صالح تماماً
      return null
    }

    if (!decodedWithoutVerify || !decodedWithoutVerify.jti) {
      return null
    }

    // التحقق من القائمة السوداء
    const isBlacklisted = await isTokenBlacklisted(decodedWithoutVerify.jti)
    if (isBlacklisted) {
      console.warn(`Access token with jti ${decodedWithoutVerify.jti} is blacklisted`)
      return null
    }

    // التحقق من صلاحية JWT باستخدام jose (متوافق مع Edge)
    const decoded = await jose.jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })

    const payload = decoded.payload as unknown as TokenPayload
    if (payload.type !== 'access') return null
    return payload
  } catch (error) {
    console.error('Error verifying access token:', error)
    return null
  }
}

// التحقق من Refresh Token مع CSRF protection - يستخدم jose
export async function verifyRefreshToken(
  token: string,
  csrfToken?: string
): Promise<RefreshTokenPayload | null> {
  try {
    const decoded = await jose.jwtVerify(token, getJwtRefreshSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })

    const payload = decoded.payload as unknown as RefreshTokenPayload
    if (payload.type !== 'refresh') return null

    // التحقق من CSRF token إذا تم توفيره
    if (csrfToken && payload.csrfToken !== csrfToken) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

// فك تشفير Refresh Token بدون التحقق (للحصول على jti و csrfToken) - يستخدم jose
export function decodeRefreshToken(token: string): { jti: string; userId: string; csrfToken: string } | null {
  try {
    const decoded = jose.decodeJwt(token) as { jti: string; userId: string; csrfToken: string } | null
    return decoded || null
  } catch {
    return null
  }
}

// ============================================================
// إدارة القائمة السوداء للتوكنات (Token Blacklist)
// ============================================================

// إضافة توكن للقائمة السوداء
export async function addToBlacklist(jti: string, reason?: string): Promise<boolean> {
  try {
    const redisAvailable = await checkRedisConnection()
    if (!redisAvailable) {
      console.warn('Redis not available, blacklist not updated')
      return false
    }

    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    if (!redis) return false

    const key = `${BLACKLIST_PREFIX}${jti}`
    const value = JSON.stringify({
      revokedAt: new Date().toISOString(),
      reason: reason || 'logout'
    })

    await redis.setex(key, BLACKLIST_TTL, value)
    return true
  } catch (error) {
    console.error('Error adding to blacklist:', error)
    return false
  }
}

// التحقق إذا كان التوكن في القائمة السوداء
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  try {
    const redisAvailable = await checkRedisConnection()
    if (!redisAvailable) {
      // إذا Redis غير متوفر، نثق بالتوكن
      return false
    }

    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    if (!redis) return false

    const key = `${BLACKLIST_PREFIX}${jti}`
    const result = await redis.get(key)
    return result !== null
  } catch (error) {
    console.error('Error checking blacklist:', error)
    return false
  }
}

// ============================================================

// استخراج Bearer token من header
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  return null
}

// Alias for backward compatibility
export function extractTokenFromHeader(authHeader: string | null): string | null {
  return extractBearerToken(authHeader)
}

// استخراج Bearer token و CSRF token من request
export function extractTokens(request: NextRequest): {
  bearerToken: string | null
  csrfToken: string | null
} {
  // استخراج Bearer token من Authorization header
  const authHeader = request.headers.get('authorization')
  const bearerToken = extractBearerToken(authHeader)

  // استخراج CSRF token من X-CSRF-Token header
  const csrfToken = request.headers.get('x-csrf-token')

  return {
    bearerToken,
    csrfToken: csrfToken || null,
  }
}

// استخراج معلومات الجهاز من Request
export function extractDeviceInfo(request: NextRequest): DeviceInfo {
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  // تحديد نوع الجهاز
  let deviceType = 'desktop'
  if (/mobile/i.test(userAgent)) deviceType = 'mobile'
  else if (/tablet/i.test(userAgent)) deviceType = 'tablet'

  // تحديد المتصفح
  let browser = 'unknown'
  if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) browser = 'Chrome'
  else if (/firefox/i.test(userAgent)) browser = 'Firefox'
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari'
  else if (/edge/i.test(userAgent)) browser = 'Edge'
  else if (/opera/i.test(userAgent)) browser = 'Opera'

  // تحديد نظام التشغيل
  let os = 'unknown'
  if (/windows/i.test(userAgent)) os = 'Windows'
  else if (/macintosh|mac os/i.test(userAgent)) os = 'macOS'
  else if (/linux/i.test(userAgent)) os = 'Linux'
  else if (/android/i.test(userAgent)) os = 'Android'
  else if (/iphone|ipad/i.test(userAgent)) os = 'iOS'

  return { userAgent, ip, deviceType, browser, os }
}

// حساب تاريخ انتهاء الصلاحية
export function getRefreshTokenExpiry(): Date {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 7) // 7 أيام
  return expiry
}

// التحقق من قوة كلمة المرور
export function validatePasswordStrength(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'كلمة المرور يجب أن تحتوي على حرف كبير' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'كلمة المرور يجب أن تحتوي على حرف صغير' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'كلمة المرور يجب أن تحتوي على رقم' }
  }
  return { valid: true, message: 'كلمة المرور قوية' }
}

// دالة لتوليد Device Fingerprint - إعادة تصدير من deviceFingerprint
export { generateDeviceFingerprint, type DeviceFingerprint } from './deviceFingerprint'
