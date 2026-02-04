/**
 * أداة المصادقة الثنائية (2FA)
 * Two-Factor Authentication Utility
 */

import { createHmac, createHash, randomBytes } from './crypto'

// إعدادات TOTP
export interface TOTPConfig {
  issuer: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period: number
}

export const DEFAULT_TOTP_CONFIG: TOTPConfig = {
  issuer: 'Alketan Hotel',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
}

/**
 * تحويل_Base32_إلى_مصفوفة_البايتات
 */
function base32ToBuffer(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  let hex = ''

  base32 = base32.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')

  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i])
    if (val === -1) {
      throw new Error('Invalid base32 character')
    }
    bits += val.toString(2).padStart(5, '0')
  }

  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const chunk = bits.slice(i, i + 8)
    hex += parseInt(chunk, 2).toString(16).padStart(2, '0')
  }

  return Buffer.from(hex, 'hex')
}

/**
 * إنشاء_رمز_TOTP
 */
export function generateTOTPCode(
  secret: string,
  config: TOTPConfig = DEFAULT_TOTP_CONFIG
): string {
  const epoch = Math.floor(Date.now() / 1000)
  const time = Math.floor(epoch / config.period)

  const secretBuffer = base32ToBuffer(secret)

  // تحويل_الوقت_إلى_مصفوفة_البايتات
  const timeBuffer = Buffer.alloc(8)
  timeBuffer.writeBigUInt64LE(BigInt(time))

  // إنشاء_رمز_التجزئة
  const hmac = createHmac(config.algorithm, secretBuffer, timeBuffer.toString('binary'))
  const hash = Buffer.from(hmac, 'hex')

  // استخراج_الرمز
  const offset = hash[hash.length - 1] & 0x0f
  const code = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  ) % Math.pow(10, config.digits)

  return code.toString().padStart(config.digits, '0')
}

/**
 * التحقق_من_صحة_رمز_TOTP
 */
export function verifyTOTPCode(
  secret: string,
  code: string,
  config: TOTPConfig = DEFAULT_TOTP_CONFIG,
  window: number = 1 // مسموح_بفارق_واحد_فترة
): boolean {
  const epoch = Math.floor(Date.now() / 1000)
  const currentPeriod = Math.floor(epoch / config.period)

  // التحقق_من_الفترة_الحالية_والمجاورة
  for (let i = -window; i <= window; i++) {
    const period = currentPeriod + i
    const timeBuffer = Buffer.alloc(8)
    timeBuffer.writeBigUInt64LE(BigInt(period))

    const secretBuffer = base32ToBuffer(secret)
    const hmac = createHmac(config.algorithm, secretBuffer, timeBuffer.toString('binary'))
    const hash = Buffer.from(hmac, 'hex')

    const offset = hash[hash.length - 1] & 0x0f
    const generatedCode = (
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)
    ) % Math.pow(10, config.digits)

    const formattedCode = generatedCode.toString().padStart(config.digits, '0')

    if (formattedCode === code) {
      return true
    }
  }

  return false
}

/**
 * إنشاء_سر_جديد_لـ_2FA
 */
export function generate2FASecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''

  for (let i = 0; i < 32; i++) {
    secret += alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return secret
}

/**
 * إنشاء_رابط_إعداد_2FA_لـ_Google_Authenticator
 */
export function generate2FASetupURL(
  secret: string,
  accountName: string,
  config: TOTPConfig = DEFAULT_TOTP_CONFIG
): string {
  const label = encodeURIComponent(`${config.issuer}:${accountName}`)
  const issuer = encodeURIComponent(config.issuer)
  const encodedSecret = secret.toUpperCase().match(/.{1,4}/g)?.join('-') || secret

  return `otpauth://totp/${label}?secret=${encodedSecret}&issuer=${issuer}&algorithm=${config.algorithm}&digits=${config.digits}&period=${config.period}`
}

/**
 * إنشاء_رموز_النسخ_الاحتياطية
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []

  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }

  return codes
}

/**
 * تجزئة_رموز_النسخ_الاحتياطية_للتخزين_الأمن
 */
export function hashBackupCode(code: string): string {
  const normalized = code.replace(/-/g, '').toLowerCase()
  return createHash('sha256', normalized)
}

/**
 * التحقق_من_رمز_النسخ_الاحتياطي
 */
export function verifyBackupCode(
  inputCode: string,
  hashedCodes: string[]
): { valid: boolean; index: number } {
  const normalizedInput = inputCode.replace(/-/g, '').toLowerCase()
  const hashedInput = createHash('sha256', normalizedInput)

  const index = hashedCodes.indexOf(hashedInput)

  return {
    valid: index !== -1,
    index: index !== -1 ? index : -1
  }
}

/**
 * إنشاء_رمز_التحقق_للاختبار
 */
export function createTestSecret(): { secret: string; codes: string[] } {
  const secret = generate2FASecret()
  const config = DEFAULT_TOTP_CONFIG

  // إنشاء_بعض_رموز_الاختبار_الصحيحة
  const codes: string[] = []
  const now = Date.now()

  for (let offset = -1; offset <= 1; offset++) {
    const epoch = Math.floor(now / 1000) + (offset * config.period)
    const time = Math.floor(epoch / config.period)

    const secretBuffer = base32ToBuffer(secret)
    const timeBuffer = Buffer.alloc(8)
    timeBuffer.writeBigUInt64LE(BigInt(time))

    const hmac = createHmac(config.algorithm, secretBuffer, timeBuffer.toString('binary'))
    const hash = Buffer.from(hmac, 'hex')

    const codeOffset = hash[hash.length - 1] & 0x0f
    const code = (
      ((hash[codeOffset] & 0x7f) << 24) |
      ((hash[codeOffset + 1] & 0xff) << 16) |
      ((hash[codeOffset + 2] & 0xff) << 8) |
      (hash[codeOffset + 3] & 0xff)
    ) % Math.pow(10, config.digits)

    codes.push(code.toString().padStart(config.digits, '0'))
  }

  return { secret, codes }
}
