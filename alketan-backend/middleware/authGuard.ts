import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '@/utils/auth'
import { prisma } from '@/lib/prisma'

// أدوار المستخدمين
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'HOUSEKEEPING' | 'GUEST'

// صلاحيات محددة لكل دور
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ADMIN: [
    'admin:all',
    'users:create', 'users:read', 'users:update', 'users:delete',
    'rooms:all', 'bookings:all', 'reports:all', 'settings:all',
    'audit:view', 'system:configure'
  ],
  ADMIN: [
    'users:create', 'users:read', 'users:update',
    'rooms:all', 'bookings:all', 'reports:all',
    'audit:view'
  ],
  MANAGER: [
    'rooms:read', 'rooms:update',
    'bookings:read', 'bookings:update', 'bookings:cancel',
    'reports:view', 'reports:export',
    'staff:manage', 'services:manage'
  ],
  RECEPTIONIST: [
    'bookings:create', 'bookings:read', 'bookings:update',
    'guests:manage', 'checkin:process', 'checkout:process'
  ],
  HOUSEKEEPING: [
    'rooms:status:update', 'cleaning:manage', 'maintenance:report'
  ],
  GUEST: [
    'bookings:create', 'bookings:own:read',
    'services:request', 'feedback:submit'
  ]
}

// التحقق من صلاحية الدور
export function isValidRole(role: string): role is UserRole {
  return role in ROLE_PERMISSIONS
}

// التحقق من صلاحية الوصول لموارد محددة
export function hasPermission(
  userRole: UserRole,
  permission: string,
  additionalChecks?: { userId?: string; resourceOwnerId?: string }
): boolean {
  //_super_admin يملك كل الصلاحيات
  if (userRole === 'SUPER_ADMIN') return true

  const permissions = ROLE_PERMISSIONS[userRole] || []

  // التحقق من الصلاحية المباشرة
  if (permissions.includes(`${permission.split(':')[0]}:all`)) return true
  if (permissions.includes(permission)) return true

  // التحقق من صلاحيات الملكية (own)
  if (permissions.includes(`${permission.split(':')[0]}:own:read`)) {
    if (additionalChecks?.userId && additionalChecks?.resourceOwnerId) {
      return additionalChecks.userId === additionalChecks.resourceOwnerId
    }
  }

  return false
}

// واجهة Request مع بيانات المستخدم
interface AuthenticatedRequest extends NextRequest {
  user?: {
    userId: string
    role: UserRole
    email: string
  }
}

// Middleware للتحقق من المصادقة والصلاحيات
export async function requireAuth(
  request: AuthenticatedRequest,
  requiredPermission?: string,
  options?: {
    require2FA?: boolean
    allowedRoles?: UserRole[]
  }
): Promise<NextResponse | null> {
  try {
    // استخراج التوكن من Header
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'المصادقة مطلوبة', code: 'AUTH_REQUIRED' },
        { status: 401 }
      )
    }

    // التحقق من صحة التوكن
    const payload = await verifyAccessToken(token)
    if (!payload || !payload.userId || !payload.role) {
      return NextResponse.json(
        { error: 'توكن غير صالح أو تم إبطاله', code: 'INVALID_TOKEN' },
        { status: 401 }
      )
    }

    // التحقق من صلاحيات الدور
    if (!isValidRole(payload.role)) {
      return NextResponse.json(
        { error: 'دور غير صالح', code: 'INVALID_ROLE' },
        { status: 403 }
      )
    }

    // التحقق من الأدوار المسموحة
    if (options?.allowedRoles && !options.allowedRoles.includes(payload.role)) {
      return NextResponse.json(
        { error: 'غير مصرح لك بالوصول لهذا المورد', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    // التحقق من الصلاحية المحددة
    if (requiredPermission && !hasPermission(payload.role as UserRole, requiredPermission)) {
      return NextResponse.json(
        { error: 'ليس لديك صلاحية لتنفيذ هذه العملية', code: 'PERMISSION_DENIED' },
        { status: 403 }
      )
    }

    // التحقق من 2FA إذا مطلوب
    if (options?.require2FA) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { twoFactorEnabled: true, lastLoginAt: true }
      })

      if (user?.twoFactorEnabled) {
        // يمكن إضافة تحقق من session 2FA هنا
        // temporarily bypassed for development
      }
    }

    // التحقق من تغير IP (أمان إضافي)
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown'
    if (process.env.NODE_ENV === 'production') {
      const session = await prisma.sessionLog.findFirst({
        where: { userId: payload.userId, logoutAt: null },
        orderBy: { loginAt: 'desc' }
      })

      if (session && session.ipAddress !== clientIP && session.ipAddress !== 'unknown') {
        // تسجيل التحذير لكن نسمح بالوصول
        console.warn(`IP changed for user ${payload.userId}: ${session.ipAddress} -> ${clientIP}`)
      }
    }

    // إرفاق بيانات المستخدم بالـ Request
    request.user = {
      userId: payload.userId,
      role: payload.role as UserRole,
      // email لا يُرسل في الـ token لأسباب أمنية
      email: ''
    }

    return null // السماح بالاستمرار

  } catch (error) {
    console.error('Auth middleware error:', error)
    return NextResponse.json(
      { error: 'حدث خطأ في المصادقة', code: 'AUTH_ERROR' },
      { status: 500 }
    )
  }
}

// Helper functions للصلاحيات الشائعة
export const PERMISSIONS = {
  // الغرف
  ROOMS_ALL: 'rooms:all',
  ROOMS_READ: 'rooms:read',
  ROOMS_UPDATE: 'rooms:update',
  ROOMS_CREATE: 'rooms:create',
  ROOMS_DELETE: 'rooms:delete',

  // الحجوزات
  BOOKINGS_ALL: 'bookings:all',
  BOOKINGS_READ: 'bookings:read',
  BOOKINGS_CREATE: 'bookings:create',
  BOOKINGS_UPDATE: 'bookings:update',
  BOOKINGS_CANCEL: 'bookings:cancel',
  BOOKINGS_OWN_READ: 'bookings:own:read',

  // التقارير
  REPORTS_ALL: 'reports:all',
  REPORTS_VIEW: 'reports:view',
  REPORTS_EXPORT: 'reports:export',

  // المستخدمون
  USERS_ALL: 'users:all',
  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',

  // التدقيق
  AUDIT_VIEW: 'audit:view',

  // الخدمات
  SERVICES_MANAGE: 'services:manage',
  SERVICES_REQUEST: 'services:request',

  // النظام
  SETTINGS_ALL: 'settings:all',
  SYSTEM_CONFIGURE: 'system:configure'
}

// Roles hierarchy (للوراثة الصلاحيات)
export const ROLE_HIERARCHY: Record<UserRole, UserRole[]> = {
  SUPER_ADMIN: [],
  ADMIN: ['MANAGER', 'RECEPTIONIST', 'HOUSEKEEPING'],
  MANAGER: ['RECEPTIONIST', 'HOUSEKEEPING'],
  RECEPTIONIST: [],
  HOUSEKEEPING: [],
  GUEST: []
}

// دالة للتحقق من الوراثة
export function hasRoleInHierarchy(
  userRole: UserRole,
  targetRole: UserRole
): boolean {
  if (userRole === targetRole) return true
  if (userRole === 'SUPER_ADMIN') return true

  const subordinates = ROLE_HIERARCHY[userRole] || []
  return subordinates.includes(targetRole)
}
