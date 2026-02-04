import { UserRole, AdminLevel } from '@prisma/client'

// نظام الصلاحيات المتقدم
export enum PermissionType {
  // System Management
  SYSTEM_CONFIGURATION = 'SYSTEM_CONFIGURATION',
  SYSTEM_MONITORING = 'SYSTEM_MONITORING',
  SYSTEM_BACKUP = 'SYSTEM_BACKUP',
  SYSTEM_RESTORE = 'SYSTEM_RESTORE',

  // User Management
  USER_CREATE = 'USER_CREATE',
  USER_READ = 'USER_READ',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  USER_BLOCK = 'USER_BLOCK',
  USER_UNBLOCK = 'USER_UNBLOCK',

  // Hotel Management
  HOTEL_CREATE = 'HOTEL_CREATE',
  HOTEL_READ = 'HOTEL_READ',
  HOTEL_UPDATE = 'HOTEL_UPDATE',
  HOTEL_DELETE = 'HOTEL_DELETE',
  HOTEL_MANAGE_STAFF = 'HOTEL_MANAGE_STAFF',
  HOTEL_FINANCIAL_REPORTS = 'HOTEL_FINANCIAL_REPORTS',
  REPORTS_VIEW = 'REPORTS_VIEW',
  HOTEL_ACCESS = 'HOTEL_ACCESS',

  // Room Management
  ROOM_CREATE = 'ROOM_CREATE',
  ROOM_READ = 'ROOM_READ',
  ROOM_UPDATE = 'ROOM_UPDATE',
  ROOM_DELETE = 'ROOM_DELETE',

  // Booking Management
  BOOKING_CREATE = 'BOOKING_CREATE',
  BOOKING_READ = 'BOOKING_READ',
  BOOKING_UPDATE = 'BOOKING_UPDATE',
  BOOKING_DELETE = 'BOOKING_DELETE',
  BOOKING_CANCEL = 'BOOKING_CANCEL',
  BOOKING_REFUND = 'BOOKING_REFUND',

  // Feature Management
  FEATURE_CREATE = 'FEATURE_CREATE',
  FEATURE_UPDATE = 'FEATURE_UPDATE',
  FEATURE_DELETE = 'FEATURE_DELETE',

  // Review Management
  REVIEW_CREATE = 'REVIEW_CREATE',
  REVIEW_READ = 'REVIEW_READ',
  REVIEW_UPDATE = 'REVIEW_UPDATE',
  REVIEW_DELETE = 'REVIEW_DELETE',
  REVIEW_MANAGE = 'REVIEW_MANAGE',

  // Loyalty Management
  LOYALTY_MANAGE = 'LOYALTY_MANAGE',
  LOYALTY_VIEW = 'LOYALTY_VIEW',

  // Financial Management
  FINANCIAL_VIEW = 'FINANCIAL_VIEW',
  FINANCIAL_UPDATE = 'FINANCIAL_UPDATE',
  PAYMENT_PROCESS = 'PAYMENT_PROCESS',
  INVOICE_GENERATE = 'INVOICE_GENERATE',
  DISCOUNT_MANAGE = 'DISCOUNT_MANAGE',
  PRICING_CONTROL = 'PRICING_CONTROL',

  // Security & Compliance
  SECURITY_AUDIT = 'SECURITY_AUDIT',
  COMPLIANCE_MONITORING = 'COMPLIANCE_MONITORING',
  DATA_EXPORT = 'DATA_EXPORT',
  DATA_DELETE = 'DATA_DELETE',
  ACCESS_LOG_VIEW = 'ACCESS_LOG_VIEW',

  // Admin Specific
  ADMIN_PANEL_ACCESS = 'ADMIN_PANEL_ACCESS',
  ROLE_MANAGEMENT = 'ROLE_MANAGEMENT',
  PERMISSION_MANAGEMENT = 'PERMISSION_MANAGEMENT',
  SYSTEM_LOGS_VIEW = 'SYSTEM_LOGS_VIEW',
  GLOBAL_SETTINGS = 'GLOBAL_SETTINGS',
  AUDIT_VIEW = 'AUDIT_VIEW',
}

export enum PermissionScope {
  GLOBAL = 'GLOBAL',     // Can perform action across all hotels
  HOTEL = 'HOTEL',       // Can perform action in assigned hotels only
  PERSONAL = 'PERSONAL', // Can only perform actions on own data
  DEPARTMENT = 'DEPARTMENT', // Can perform actions in specific department
}

// التحقق من الصلاحيات
export function hasPermission(
  userRole: UserRole,
  adminLevel: AdminLevel | null | undefined,
  requiredPermission: PermissionType,
  scope?: PermissionScope
): boolean {
  // SUPER_ADMIN لديه جميع الصلاحيات
  if (adminLevel === AdminLevel.SUPER_ADMIN) {
    return true
  }

  // SYSTEM_ADMIN لديه صلاحيات النظام
  if (adminLevel === AdminLevel.SYSTEM_ADMIN) {
    const systemPermissions = [
      PermissionType.SYSTEM_CONFIGURATION,
      PermissionType.SYSTEM_MONITORING,
      PermissionType.USER_CREATE,
      PermissionType.USER_READ,
      PermissionType.USER_UPDATE,
      PermissionType.USER_DELETE,
      PermissionType.ADMIN_PANEL_ACCESS,
      PermissionType.SYSTEM_LOGS_VIEW,
      // Add more as needed
      PermissionType.HOTEL_READ,
      PermissionType.HOTEL_UPDATE,
      PermissionType.FEATURE_CREATE,
      PermissionType.FEATURE_UPDATE,
      PermissionType.FEATURE_DELETE,
      PermissionType.REVIEW_DELETE,
      PermissionType.LOYALTY_MANAGE,
      PermissionType.AUDIT_VIEW,
    ]
    return systemPermissions.includes(requiredPermission)
  }

  // HOTEL_ADMIN لديه صلاحيات إدارة الفنادق
  if (adminLevel === AdminLevel.HOTEL_ADMIN || userRole === UserRole.HOTEL_MANAGER) {
    const hotelPermissions = [
      PermissionType.HOTEL_READ,
      PermissionType.HOTEL_UPDATE,
      PermissionType.HOTEL_MANAGE_STAFF,
      PermissionType.HOTEL_FINANCIAL_REPORTS,
      PermissionType.BOOKING_READ,
      PermissionType.BOOKING_UPDATE,
      PermissionType.BOOKING_CANCEL,
      PermissionType.FINANCIAL_VIEW,
      PermissionType.INVOICE_GENERATE,
      PermissionType.FEATURE_CREATE,
      PermissionType.FEATURE_UPDATE,
      PermissionType.FEATURE_DELETE,
      PermissionType.REVIEW_READ,
      PermissionType.REVIEW_DELETE, // Can moderate reviews
      PermissionType.LOYALTY_MANAGE,
      PermissionType.PAYMENT_PROCESS,
      PermissionType.ROOM_CREATE,
      PermissionType.ROOM_READ,
      PermissionType.ROOM_UPDATE,
      PermissionType.ROOM_DELETE,
    ]
    return hotelPermissions.includes(requiredPermission)
  }

  // ACCOUNTANT لديه صلاحيات مالية
  if (userRole === UserRole.ACCOUNTANT) {
    const accountingPermissions = [
      PermissionType.FINANCIAL_VIEW,
      PermissionType.FINANCIAL_UPDATE,
      PermissionType.PAYMENT_PROCESS,
      PermissionType.INVOICE_GENERATE,
      PermissionType.HOTEL_FINANCIAL_REPORTS,
      PermissionType.BOOKING_READ,
    ]
    return accountingPermissions.includes(requiredPermission)
  }

  // RECEPTIONIST لديه صلاحيات الاستقبال
  if (userRole === UserRole.RECEPTIONIST) {
    const receptionPermissions = [
      PermissionType.BOOKING_READ,
      PermissionType.BOOKING_UPDATE,
      PermissionType.BOOKING_CREATE,
      PermissionType.PAYMENT_PROCESS,
      PermissionType.REVIEW_READ,
    ]
    return receptionPermissions.includes(requiredPermission)
  }

  // USER لديه صلاحيات أساسية
  if (userRole === UserRole.USER) {
    const userPermissions = [
      PermissionType.BOOKING_CREATE,
      PermissionType.BOOKING_READ,
      PermissionType.BOOKING_CANCEL,
      PermissionType.REVIEW_CREATE,
      PermissionType.REVIEW_READ,
      PermissionType.REVIEW_UPDATE, // Own only (handled by logic)
      PermissionType.REVIEW_DELETE, // Own only (handled by logic)
      PermissionType.LOYALTY_VIEW,
    ]
    return userPermissions.includes(requiredPermission)
  }

  // GUEST لديه صلاحيات محدودة
  if (userRole === UserRole.GUEST) {
    const guestPermissions = [
      PermissionType.REVIEW_READ,
    ]
    return guestPermissions.includes(requiredPermission)
  }

  return false
}

// الصلاحيات المطلوبة لكل عملية (للتوافق مع الكود القديم)
export const Permissions = {
  // إدارة المستخدمين
  CREATE_USER: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  UPDATE_USER: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT],
  DELETE_USER: [UserRole.ADMIN],
  VIEW_ALL_USERS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT],

  // إدارة الفنادق
  CREATE_HOTEL: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  UPDATE_HOTEL: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  DELETE_HOTEL: [UserRole.ADMIN],
  VIEW_ALL_HOTELS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.ACCOUNTANT, UserRole.USER, UserRole.GUEST],

  // إدارة الغرف
  CREATE_ROOM: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  UPDATE_ROOM: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  DELETE_ROOM: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],

  // إدارة الحجوزات
  CREATE_BOOKING: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.USER],
  UPDATE_BOOKING: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST],
  CANCEL_BOOKING: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.USER],
  VIEW_ALL_BOOKINGS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.ACCOUNTANT],

  // إدارة المميزات
  CREATE_FEATURE: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  UPDATE_FEATURE: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  DELETE_FEATURE: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],

  // مسح QR Code
  SCAN_QR_CODE: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST],

  // المدفوعات
  PROCESS_PAYMENT: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.ACCOUNTANT, UserRole.USER],
  VIEW_PAYMENTS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT],

  // التقييمات
  CREATE_REVIEW: [UserRole.USER],
  VIEW_REVIEWS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.USER, UserRole.GUEST],

  // المفضلة
  MANAGE_WISHLIST: [UserRole.USER],

  // الإشعارات
  VIEW_NOTIFICATIONS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.ACCOUNTANT, UserRole.USER],
  SEND_NOTIFICATIONS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],

  // الولاء
  MANAGE_LOYALTY: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  VIEW_LOYALTY: [UserRole.USER],

  // الألعاب والمسابقات
  PLAY_GAMES: [UserRole.USER],
  MANAGE_GAMES: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],

  // الخدمات
  MANAGE_SERVICES: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  VIEW_SERVICES: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST, UserRole.USER],

  // الخصومات
  MANAGE_DISCOUNTS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER],
  USE_DISCOUNTS: [UserRole.USER],

  // الفواتير
  GENERATE_INVOICE: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT],
  VIEW_INVOICES: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT, UserRole.USER],

  // إحصائيات الفندق
  VIEW_HOTEL_STATS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.ACCOUNTANT],
  VIEW_HOTEL_GUESTS: [UserRole.ADMIN, UserRole.HOTEL_MANAGER, UserRole.RECEPTIONIST],
}

// Helper function للتحقق من الصلاحيات (للتوافق مع الكود القديم)
export function authorize(userRole: UserRole, requiredRoles: UserRole[]): boolean {
  return requiredRoles.includes(userRole)
}
