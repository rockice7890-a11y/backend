/**
 * Crypto utilities compatible with Edge Runtime
 */

// الحصول على crypto module بشكل ديناميكي
function getCrypto() {
  if (typeof window !== 'undefined') {
    return window.crypto
  }
  try {
    return require('crypto')
  } catch {
    return null
  }
}

// إنشاء HMAC
export function createHmac(algorithm: string, key: string | Buffer, data: string | Buffer): string {
  const cryptoModule = getCrypto()
  if (!cryptoModule) {
    throw new Error('Crypto module not available')
  }
  const hmac = cryptoModule.createHmac(algorithm, key)
  hmac.update(data)
  return hmac.digest('hex')
}

// إنشاء Hash
export function createHash(algorithm: string, data: string): string {
  const cryptoModule = getCrypto()
  if (!cryptoModule) {
    throw new Error('Crypto module not available')
  }
  return cryptoModule.createHash(algorithm).update(data).digest('hex')
}

// توليد bytes عشوائية
export function randomBytes(size: number): string {
  if (typeof window !== 'undefined') {
    // Web Crypto API
    const bytes = new Uint8Array(size)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const cryptoModule = getCrypto()
  if (!cryptoModule) {
    throw new Error('Crypto module not available')
  }
  return cryptoModule.randomBytes(size).toString('hex')
}

// تحويل إلى Buffer
export function toBuffer(data: string | Buffer): Buffer {
  if (Buffer.isBuffer(data)) return data
  return Buffer.from(data)
}

// مقارنة timing-safe
export function timingSafeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const cryptoModule = getCrypto()
  if (!cryptoModule) {
    return a.toString() === b.toString()
  }
  try {
    const bufA = toBuffer(a)
    const bufB = toBuffer(b)
    if (bufA.length !== bufB.length) return false
    return cryptoModule.timingSafeEqual(bufA, bufB)
  } catch {
    return a.toString() === b.toString()
  }
}

// إنشاء Base32 secret
export function generateBase32Secret(length: number = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const bytes = Math.ceil(length * 5 / 8)
  const randomValues = new Uint8Array(bytes)
  
  if (typeof window !== 'undefined') {
    window.crypto.getRandomValues(randomValues)
  } else {
    const cryptoModule = getCrypto()
    if (cryptoModule) {
      cryptoModule.randomBytes(bytes).copy(randomValues)
    }
  }
  
  for (let i = 0; i < length; i++) {
    const byteIndex = Math.floor(i * 5 / 8)
    const bitOffset = (i * 5) % 8
    const char = (randomValues[byteIndex] >> (3 - bitOffset)) & 31
    secret += alphabet[char]
  }
  
  return secret
}
