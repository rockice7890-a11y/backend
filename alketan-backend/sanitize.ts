import DOMPurify from 'isomorphic-dompurify'
import validator from 'validator'

/**
 * تنظيف Input من XSS
 */
export function sanitizeInput(input: string): string {
  if (!input) return ''
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // لا تسمح بأي HTML tags
    ALLOWED_ATTR: [],
  })
}

/**
 * تنظيف HTML (للسماح ببعض Tags)
 */
export function sanitizeHTML(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: [],
  })
}

/**
 * التحقق من صحة البريد الإلكتروني
 */
export function validateEmail(email: string): boolean {
  return validator.isEmail(email)
}

/**
 * التحقق من صحة رقم الهاتف
 */
export function validatePhone(phone: string, locale: string = 'ar-SA'): boolean {
  return validator.isMobilePhone(phone, locale as any)
}

/**
 * التحقق من صحة URL
 */
export function validateURL(url: string): boolean {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
  })
}

/**
 * تنظيف رقم الهاتف
 */
export function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '')
}

/**
 * التحقق من صحة التاريخ
 */
export function validateDate(date: string | Date): boolean {
  return validator.isISO8601(date.toString())
}

/**
 * تنظيف جميع الحقول في Object
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized = { ...obj }
  
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeInput(sanitized[key]) as any
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key]) as any
    }
  }
  
  return sanitized
}

