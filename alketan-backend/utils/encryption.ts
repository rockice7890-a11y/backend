import crypto from 'crypto'

// مفتاح التشفير من البيئة
const ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY || 
  'default-key-change-in-production-32chars!'
const IV_LENGTH = 16
const ALGORITHM = 'aes-256-gcm'

// دالة التشفير
export function encrypt(text: string): string {
  if (!text) return text

  try {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
      iv
    )

    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()

    // إرجاع IV + AuthTag + البيانات المشفرة
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted
  } catch (error) {
    console.error('Encryption error:', error)
    throw new Error('فشل في تشفير البيانات')
  }
}

// دالة فك التشفير
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText

  try {
    const parts = encryptedText.split(':')
    if (parts.length !== 3) {
      throw new Error('صيغة البيانات المشفرة غير صحيحة')
    }

    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = parts[2]

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
      iv
    )

    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('Decryption error:', error)
    throw new Error('فشل في فك تشفير البيانات')
  }
}

// تشفير الحقول الحساسة في الكائن
export function encryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  sensitiveFields: (keyof T)[]
): T {
  const encrypted = { ...data }
  
  for (const field of sensitiveFields) {
    if (encrypted[field] && typeof encrypted[field] === 'string') {
      encrypted[field] = encrypt(encrypted[field] as string) as any
    }
  }

  return encrypted
}

// فك تشفير الحقول الحساسة في الكائن
export function decryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  sensitiveFields: (keyof T)[]
): T {
  const decrypted = { ...data }

  for (const field of sensitiveFields) {
    if (decrypted[field] && typeof decrypted[field] === 'string') {
      try {
        decrypted[field] = decrypt(decrypted[field] as string) as any
      } catch {
        // إذا فشل فك التشفير، نترك القيمة كما هي
        console.warn(`فشل في فك تشفير الحقل: ${String(field)}`)
      }
    }
  }

  return decrypted
}

// توليد-hash آمن للكلمات المرور
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

// التحقق من كلمة المرور
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':')
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return hash === verifyHash
}

// توليد معرف فريد آمن
export function generateSecureId(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}

// تشفير JSON كامل
export function encryptJSON(data: Record<string, any>): string {
  return encrypt(JSON.stringify(data))
}

// فك تشفير JSON
export function decryptJSON<T = Record<string, any>>(encryptedData: string): T {
  const decrypted = decrypt(encryptedData)
  return JSON.parse(decrypted)
}

// الحقول التي يجب تشفيرها تلقائياً في قاعدة البيانات
export const SENSITIVE_FIELDS = {
  user: ['password', 'ssn', 'nationalId', 'bankAccount'] as const,
  booking: ['guestNotes', 'specialRequests'] as const,
  employee: ['salary', 'bankAccount', 'personalInfo'] as const,
  guest: ['passportNumber', 'nationalId', 'paymentInfo'] as const
} as const
