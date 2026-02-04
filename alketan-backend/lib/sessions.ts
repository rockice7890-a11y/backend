import { getRedis, redisUtils } from './redis'
import { encrypt, decrypt } from '@/utils/encryption'

// إعدادات الجلسات
const SESSION_TTL = 24 * 60 * 60 // 24 ساعة بالثواني
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 // 7 أيام للـ Refresh Token
const SESSION_PREFIX = 'session:'
const USER_SESSIONS_PREFIX = 'user:sessions:'
const REFRESH_TOKEN_PREFIX = 'refresh:'

// نوع بيانات الجلسة
export interface SessionData {
  userId: string
  sessionId: string
  role: string
  adminLevel?: string | null
  email?: string
  ipAddress: string
  userAgent: string
  deviceFingerprint?: string
  createdAt: string
  lastActivity: string
  expiresAt: string
}

// نوع بيانات Refresh Token
export interface RefreshTokenData {
  userId: string
  sessionId: string
  tokenId: string
  createdAt: string
  expiresAt: string
  isRevoked: boolean
  revokedAt?: string
  replacedBy?: string
}

// إنشاء جلسة جديدة
export async function createSession(data: Omit<SessionData, 'createdAt' | 'lastActivity' | 'expiresAt'>): Promise<string> {
  const redis = getRedis()
  if (!redis) {
    throw new Error('Redis not available')
  }

  const sessionId = generateSessionId()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString()

  const session: SessionData = {
    ...data,
    sessionId,
    createdAt: now,
    lastActivity: now,
    expiresAt,
  }

  // تشفير بيانات الجلسة قبل التخزين
  const encryptedSession = encrypt(JSON.stringify(session))

  // تخزين الجلسة
  await redisUtils.setex(
    `${SESSION_PREFIX}${sessionId}`,
    SESSION_TTL,
    encryptedSession
  )

  // إضافة الجلسة لقائمة جلسات المستخدم
  await redisUtils.sadd(`${USER_SESSIONS_PREFIX}${data.userId}`, sessionId)

  // تخزين معلومات المستخدم بشكل منفصل للـ Rate Limiting السريع
  await redisUtils.setex(
    `user:${data.userId}:session:${sessionId}`,
    SESSION_TTL,
    JSON.stringify({ role: data.role, adminLevel: data.adminLevel })
  )

  return sessionId
}

// الحصول على جلسة
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const redis = getRedis()
  if (!redis) {
    return null
  }

  const encryptedSession = await redisUtils.get(`${SESSION_PREFIX}${sessionId}`)
  if (!encryptedSession) {
    return null
  }

  try {
    const session = JSON.parse(decrypt(encryptedSession)) as SessionData

    // التحقق من انتهاء الصلاحية
    if (new Date(session.expiresAt) < new Date()) {
      await deleteSession(sessionId, session.userId)
      return null
    }

    return session
  } catch (error) {
    console.error('Failed to parse session:', error)
    return null
  }
}

// تحديث آخر نشاط للجلسة
export async function touchSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId)
  if (!session) return

  session.lastActivity = new Date().toISOString()

  // إعادة تعيين وقت الانتهاء
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString()
  session.expiresAt = expiresAt

  const encryptedSession = encrypt(JSON.stringify(session))
  await redisUtils.setex(
    `${SESSION_PREFIX}${sessionId}`,
    SESSION_TTL,
    encryptedSession
  )
}

// حذف جلسة
export async function deleteSession(sessionId: string, userId?: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) {
    return false
  }

  // الحصول على الجلسة أولاً للحصول على userId
  let sessionUserId = userId
  if (!sessionUserId) {
    const session = await getSession(sessionId)
    sessionUserId = session?.userId
  }

  // حذف الجلسة
  await redisUtils.del(`${SESSION_PREFIX}${sessionId}`)

  // حذف معلومات المستخدم
  await redisUtils.del(`user:${sessionUserId}:session:${sessionId}`)

  // إزالة الجلسة من قائمة جلسات المستخدم
  if (sessionUserId) {
    await redisUtils.srem(`${USER_SESSIONS_PREFIX}${sessionUserId}`, sessionId)
  }

  return true
}

// حذف جميع جلسات المستخدم
export async function deleteAllUserSessions(userId: string): Promise<number> {
  const sessionIds = await redisUtils.smembers(`${USER_SESSIONS_PREFIX}${userId}`)

  for (const sessionId of sessionIds) {
    await redisUtils.del(`${SESSION_PREFIX}${sessionId}`)
    await redisUtils.del(`user:${userId}:session:${sessionId}`)
  }

  // حذف المجموعة نفسها
  await redisUtils.del(`${USER_SESSIONS_PREFIX}${userId}`)

  return sessionIds.length
}

// الحصول على جميع جلسات المستخدم
export async function getUserSessions(userId: string): Promise<SessionData[]> {
  const sessionIds = await redisUtils.smembers(`${USER_SESSIONS_PREFIX}${userId}`)
  const sessions: SessionData[] = []

  for (const sessionId of sessionIds) {
    const session = await getSession(sessionId)
    if (session) {
      sessions.push(session)
    }
  }

  return sessions.sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  )
}

// التحقق من صلاحية الجلسة
export async function validateSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await getSession(sessionId)
  if (!session) return false

  // التحقق من أن الجلسة تنتمي للمستخدم
  if (session.userId !== userId) return false

  // التحقق من انتهاء الصلاحية
  if (new Date(session.expiresAt) < new Date()) return false

  return true
}

// الحصول على معلومات المستخدم من الجلسة
export async function getSessionUserInfo(sessionId: string): Promise<{
  userId: string
  role: string
  adminLevel?: string | null
} | null> {
  const session = await getSession(sessionId)
  if (!session) return null

  return {
    userId: session.userId,
    role: session.role,
    adminLevel: session.adminLevel,
  }
}

// إنشاء معرف جلسة فريد
function generateSessionId(): string {
  const crypto = require('crypto')
  return crypto.randomBytes(32).toString('hex')
}

// Token Rotation Functions

// إنشاء Refresh Token
export async function createRefreshToken(
  userId: string,
  sessionId: string
): Promise<string> {
  const redis = getRedis()
  if (!redis) {
    throw new Error('Redis not available')
  }

  const tokenId = generateTokenId()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString()

  const refreshToken: RefreshTokenData = {
    userId,
    sessionId,
    tokenId,
    createdAt: now,
    expiresAt,
    isRevoked: false,
  }

  // تشفير وتخزين Refresh Token
  const encryptedToken = encrypt(JSON.stringify(refreshToken))
  await redisUtils.setex(
    `${REFRESH_TOKEN_PREFIX}${tokenId}`,
    REFRESH_TOKEN_TTL,
    encryptedToken
  )

  // ربط Refresh Token بالمستخدم
  await redisUtils.sadd(`user:${userId}:refreshTokens`, tokenId)

  return tokenId
}

// التحقق من Refresh Token
export async function validateRefreshToken(
  tokenId: string
): Promise<RefreshTokenData | null> {
  const redis = getRedis()
  if (!redis) {
    return null
  }

  const encryptedToken = await redisUtils.get(`${REFRESH_TOKEN_PREFIX}${tokenId}`)
  if (!encryptedToken) {
    return null
  }

  try {
    const token = JSON.parse(decrypt(encryptedToken)) as RefreshTokenData

    // التحقق من الإلغاء
    if (token.isRevoked) return null

    // التحقق من انتهاء الصلاحية
    if (new Date(token.expiresAt) < new Date()) return null

    return token
  } catch (error) {
    console.error('Failed to parse refresh token:', error)
    return null
  }
}

// إبطال Refresh Token (عند استخدامه)
export async function revokeRefreshToken(tokenId: string, replacedBy?: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) {
    return false
  }

  const token = await validateRefreshToken(tokenId)
  if (!token) return false

  token.isRevoked = true
  token.revokedAt = new Date().toISOString()
  if (replacedBy) {
    token.replacedBy = replacedBy
  }

  // تشفير وتخزين التحديث
  const encryptedToken = encrypt(JSON.stringify(token))
  await redisUtils.setex(
    `${REFRESH_TOKEN_PREFIX}${tokenId}`,
    REFRESH_TOKEN_TTL,
    encryptedToken
  )

  return true
}

// إبطال جميع Refresh Tokens للمستخدم
export async function revokeAllUserRefreshTokens(userId: string): Promise<number> {
  const tokenIds = await redisUtils.smembers(`user:${userId}:refreshTokens`)
  let revokedCount = 0

  for (const tokenId of tokenIds) {
    const revoked = await revokeRefreshToken(tokenId)
    if (revoked) revokedCount++
  }

  // حذف قائمة Refresh Tokens
  await redisUtils.del(`user:${userId}:refreshTokens`)

  return revokedCount
}

// توليد معرف Token فريد
function generateTokenId(): string {
  const crypto = require('crypto')
  return crypto.randomBytes(16).toString('hex')
}

// الحصول على معلومات المستخدم من Redis (للـ Rate Limiting)
export async function getUserInfoForRateLimit(userId: string): Promise<{
  hasActiveSession: boolean
  role: string
  adminLevel?: string | null
} | null> {
  const sessions = await getUserSessions(userId)
  if (sessions.length === 0) return null

  const latestSession = sessions[0]
  return {
    hasActiveSession: true,
    role: latestSession.role,
    adminLevel: latestSession.adminLevel,
  }
}

// تصدير الثوابت
export const SESSION_CONFIG = {
  TTL: SESSION_TTL,
  REFRESH_TOKEN_TTL: REFRESH_TOKEN_TTL,
  PREFIX: SESSION_PREFIX,
  USER_SESSIONS_PREFIX: USER_SESSIONS_PREFIX,
  REFRESH_TOKEN_PREFIX: REFRESH_TOKEN_PREFIX,
}
