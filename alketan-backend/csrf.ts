import crypto from 'crypto'

/**
 * إنشاء CSRF Token فريد
 */
export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * التحقق من CSRF Token
 * يستخدم timing-safe comparison لمنع timing attacks
 */
export function verifyCSRFToken(token: string | null, expectedToken: string | null): boolean {
  if (!token || !expectedToken) return false
  
  try {
    const tokenBuffer = Buffer.from(token, 'hex')
    const expectedBuffer = Buffer.from(expectedToken, 'hex')
    
    // التحقق من نفس الطول
    if (tokenBuffer.length !== expectedBuffer.length) return false
    
    // استخدام timing-safe comparison
    return crypto.timingSafeEqual(tokenBuffer, expectedBuffer)
  } catch {
    return false
  }
}

/**
 * إنشاء secret لـ CSRF
 */
export function generateCSRFSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * إنشاء signed CSRF token
 */
export function createSignedCSRFToken(secret: string): string {
  const token = crypto.randomBytes(32).toString('hex')
  const signature = crypto
    .createHmac('sha256', secret)
    .update(token)
    .digest('hex')
  
  return `${token}.${signature}`
}

/**
 * التحقق من signed CSRF token
 */
export function verifySignedCSRFToken(token: string, secret: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  
  const [tokenPart, signaturePart] = parts
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(tokenPart)
    .digest('hex')
  
  // استخدام timing-safe comparison
  const signatureBuffer = Buffer.from(signaturePart, 'hex')
  const expectedBuffer = Buffer.from(expectedSignature, 'hex')
  
  try {
    if (signatureBuffer.length !== expectedBuffer.length) return false
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch {
    return false
  }
}
