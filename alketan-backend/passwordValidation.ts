/**
 * أداة التحقق من قوة كلمة المرور
 * Password Strength Validation Utility
 */

// متطلبات قوة كلمة المرور
export interface PasswordRequirements {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecialChar: boolean
  maxLength: number
  prohibitedPatterns: string[]
}

// الإعدادات الافتراضية
export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
  maxLength: 128,
  prohibitedPatterns: [
    'password',
    '123456',
    'qwerty',
    'admin',
    'guest',
    'welcome',
  ],
}

// رسالة الخطأ بالعربية
export interface ValidationResult {
  isValid: boolean
  errors: string[]
  strength: 'weak' | 'medium' | 'strong' | 'very_strong'
  score: number // 0-4
}

// حساب قوة كلمة المرور
export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): ValidationResult {
  const errors: string[] = []
  let score = 0

  // التحقق من الطول
  if (password.length < requirements.minLength) {
    errors.push(`كلمة المرور يجب أن تكون ${requirements.minLength} أحرف على الأقل`)
  } else if (password.length > requirements.maxLength) {
    errors.push(`كلمة المرور يجب أن تكون ${requirements.maxLength} أحرف على الأكثر`)
  } else {
    score += 1
  }

  // التحقق من الأحرف الكبيرة
  if (requirements.requireUppercase) {
    if (!/[A-Z]/.test(password)) {
      errors.push('يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل')
    } else {
      score += 1
    }
  }

  // التحقق من الأحرف الصغيرة
  if (requirements.requireLowercase) {
    if (!/[a-z]/.test(password)) {
      errors.push('يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل')
    } else {
      score += 1
    }
  }

  // التحقق من الأرقام
  if (requirements.requireNumber) {
    if (!/\d/.test(password)) {
      errors.push('يجب أن تحتوي كلمة المرور على رقم واحد على الأقل')
    } else {
      score += 1
    }
  }

  // التحقق من الأحرف الخاصة
  if (requirements.requireSpecialChar) {
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('يجب أن تحتوي كلمة المرور على حرف خاص واحد على الأقل (!@#$%^&*)')
    } else {
      score += 1
    }
  }

  // التحقق من الأنماط المحظورة
  const lowerPassword = password.toLowerCase()
  for (const pattern of requirements.prohibitedPatterns) {
    if (lowerPassword.includes(pattern)) {
      errors.push('كلمة المرور تحتوي على نمط سهل التخمين')
      score = Math.max(0, score - 1)
      break
    }
  }

  // التحقق من التكرار المتتابع
  if (/(.)\1{3,}/.test(password)) {
    errors.push('كلمة المرور لا يجب أن تحتوي على أحرف متتالية متكررة أكثر من 3 مرات')
    score = Math.max(0, score - 1)
  }

  // التحقق من الأرقام المتتالية
  if (/(?:0(?=1)|1(?=2)|2(?=3)|3(?=4)|4(?=5)|5(?=6)|6(?=7)|7(?=8)|8(?=9)|9(?=0)){4,}/.test(password)) {
    errors.push('كلمة المرور لا يجب أن تحتوي على أرقام متتالية (مثل 1234)')
    score = Math.max(0, score - 1)
  }

  // تحديد مستوى القوة
  let strength: 'weak' | 'medium' | 'strong' | 'very_strong'
  if (score <= 1) {
    strength = 'weak'
  } else if (score === 2) {
    strength = 'medium'
  } else if (score === 3) {
    strength = 'strong'
  } else {
    strength = 'very_strong'
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
    score,
  }
}

// التحقق السريع (للاستخدام في النماذج)
export function isPasswordValid(
  password: string,
  requirements?: PasswordRequirements
): boolean {
  return validatePassword(password, requirements).isValid
}

// الحصول على نصائح لتحسين كلمة المرور
export function getPasswordTips(password: string): string[] {
  const tips: string[] = []

  if (password.length < 8) {
    tips.push('• استخدم 8 أحرف أو أكثر')
  }
  if (!/[A-Z]/.test(password)) {
    tips.push('• أضف أحرفاً كبيرة (A-Z)')
  }
  if (!/[a-z]/.test(password)) {
    tips.push('• أضف أحرفاً صغيرة (a-z)')
  }
  if (!/\d/.test(password)) {
    tips.push('• أضف أرقاماً (0-9)')
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    tips.push('• أضف أحرفاً خاصة (!@#$%^&*)')
  }
  if (/(.)\1{3,}/.test(password)) {
    tips.push('• تجنب تكرار نفس الحرف أكثر من 3 مرات متتالية')
  }

  return tips
}

// التحقق من أن كلمة المرور ليست من كلمات المرور الشائعة
export function isCommonPassword(password: string): boolean {
  const commonPasswords = [
    'password', '123456', '12345678', 'qwerty', 'abc123',
    'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
    'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
    'bailey', 'passw0rd', 'shadow', '123123', '654321',
    'superman', 'qazwsx', 'michael', 'football', 'password1',
    'password123', 'welcome', 'jesus', 'ninja', 'mustang',
  ]

  return commonPasswords.includes(password.toLowerCase())
}

// التحقق من أن كلمة المرور لا تحتوي على معلومات شخصية
export function containsPersonalInfo(
  password: string,
  userData: {
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
  }
): boolean {
  const checks = [
    userData.firstName?.toLowerCase(),
    userData.lastName?.toLowerCase(),
    userData.email?.split('@')[0].toLowerCase(),
    userData.phone?.replace(/\D/g, ''),
  ].filter(Boolean) as string[]

  const lowerPassword = password.toLowerCase()

  for (const check of checks) {
    if (check && check.length > 3 && lowerPassword.includes(check)) {
      return true
    }
  }

  return false
}
