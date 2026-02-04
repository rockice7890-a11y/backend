/**
 * نظام الإشعارات الفورية للأمان
 * Security Push Notification System
 */

import { logInfo, logError } from '@/utils/logger'

// واجهة الإشعار الفوري
export interface PushNotification {
  userId: string
  title: string
  body: string
  icon?: string
  badge?: string
  data?: Record<string, string>
  actions?: Array<{ action: string; title: string }>
}

// واجهة مستخدم الجهاز
interface UserDevice {
  id: string
  userId: string
  deviceId: string
  deviceType: string
  pushToken: string | null
  isActive: boolean
}

// واجهة قالب الإشعار
interface NotificationTemplate {
  title: string
  body: string
  icon: string
  badge: string
  actions?: Array<{ action: string; title: string }>
}

// دوال التنسيق للإشعارات الأمنية
const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  LOGIN_NEW: {
    title: '🔐 تسجيل دخول جديد',
    body: 'تم تسجيل دخول إلى حسابك من جهاز جديد',
    icon: 'security_login',
    badge: 'security',
  },
  LOGIN_FAILED: {
    title: '⚠️ محاولة تسجيل دخول',
    body: 'تم رصد محاولة تسجيل دخول فاشلة',
    icon: 'security_warning',
    badge: 'warning',
  },
  ACCOUNT_LOCKED: {
    title: '🔒 حسابك محظور',
    body: 'تم قفل حسابك مؤقتاً بسبب محاولات متكررة',
    icon: 'security_lock',
    badge: 'critical',
  },
  TFA_ENABLED: {
    title: '✅ تم تفعيل الأمان',
    body: 'المصادقة الثنائية مفعلة الآن',
    icon: 'security_check',
    badge: 'success',
  },
  TFA_DISABLED: {
    title: '⚠️ تم تعطيل الأمان',
    body: 'المصادقة الثنائية تم تعطيلها',
    icon: 'security_warning',
    badge: 'warning',
  },
  PASSWORD_CHANGED: {
    title: '🔑 تم تغيير كلمة المرور',
    body: 'تم تغيير كلمة المرور بنجاح',
    icon: 'security_key',
    badge: 'success',
  },
  SUSPICIOUS_ACTIVITY: {
    title: '🚨 نشاط مشبوه',
    body: 'تم رصد نشاط غير معتاد على حسابك',
    icon: 'security_alert',
    badge: 'critical',
    actions: [
      { action: 'review', title: 'مراجعة' },
      { action: 'secure', title: 'تأمين' },
    ],
  },
  SESSION_TERMINATED: {
    title: '📴 تم إنهاء جلسة',
    body: 'تم إنهاء إحدى جلساتك',
    icon: 'security_logout',
    badge: 'info',
  },
  NEW_DEVICE: {
    title: '📱 جهاز جديد',
    body: 'تم إضافة جهاز جديد إلى حسابك',
    icon: 'security_device',
    badge: 'info',
  },
}

// إرسال إشعار فوري لجهاز واحد
export async function sendPushNotification(
  device: UserDevice,
  notification: Omit<PushNotification, 'userId'>
): Promise<boolean> {
  if (!device.pushToken || !device.isActive) {
    return false
  }

  try {
    // في الإنتاج، استخدم firebase-admin أو خدمة إشعارات حقيقية
    // هذا تنفيذ للتطوير والاختبار

    const payload = {
      to: device.pushToken,
      notification: {
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        badge: notification.badge,
      },
      data: notification.data,
      webpush: {
        fcmOptions: {
          link: notification.data?.url || '/security',
        },
      },
    }

    logInfo('Push notification sent (simulated)', {
      deviceId: device.deviceId,
      title: notification.title,
    })

    // محاكاة نجاح الإرسال
    return true

  } catch (error) {
    logError('Failed to send push notification', {
      error,
      deviceId: device.deviceId,
      userId: device.userId,
    })
    return false
  }
}

// إرسال إشعار لجميع أجهزة المستخدم
export async function sendPushNotificationToUser(
  prisma: any,
  userId: string,
  templateKey: keyof typeof NOTIFICATION_TEMPLATES,
  data?: Record<string, string>
): Promise<number> {
  try {
    const template = NOTIFICATION_TEMPLATES[templateKey]
    if (!template) {
      logError('Unknown notification template', { templateKey })
      return 0
    }

    // جلب أجهزة المستخدم النشطة
    const devices = await prisma.userDevice.findMany({
      where: {
        userId,
        isActive: true,
        pushToken: { not: null },
      },
    })

    if (devices.length === 0) {
      return 0
    }

    const notification: Omit<PushNotification, 'userId'> = {
      title: template.title,
      body: template.body,
      icon: template.icon,
      badge: template.badge,
      data: data as Record<string, string>,
      ...(template.actions && { actions: template.actions }),
    }

    // إرسال الإشعار لجميع الأجهزة
    const results = await Promise.all(
      devices.map((device: UserDevice) => sendPushNotification(device, notification))
    )

    const successCount = results.filter(Boolean).length

    logInfo('Push notifications sent', {
      userId,
      templateKey,
      totalDevices: devices.length,
      successCount,
    })

    return successCount

  } catch (error) {
    logError('Failed to send push notifications to user', { error, userId })
    return 0
  }
}

// إشعار تسجيل دخول جديد
export async function notifyNewLogin(
  prisma: any,
  userId: string,
  details: { device: string; ip: string; time: Date }
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'LOGIN_NEW', {
    device: details.device,
    ip: details.ip,
    time: details.time.toISOString(),
    url: '/security/sessions',
  })
}

// إشعار محاولة تسجيل دخول فاشلة
export async function notifyFailedLogin(
  prisma: any,
  userId: string,
  details: { attempts: number; ip: string }
): Promise<number> {
  // فقط إشعار إذا كان أكثر من 3 محاولات
  if (details.attempts < 3) {
    return 0
  }

  return sendPushNotificationToUser(prisma, userId, 'LOGIN_FAILED', {
    attempts: details.attempts.toString(),
    ip: details.ip,
  })
}

// إشعار قفل الحساب
export async function notifyAccountLocked(
  prisma: any,
  userId: string,
  details: { reason: string; duration: number }
): Promise<number> {
  const template = NOTIFICATION_TEMPLATES.ACCOUNT_LOCKED

  return sendPushNotificationToUser(prisma, userId, 'ACCOUNT_LOCKED', {
    reason: details.reason,
    duration: details.duration.toString(),
    url: '/security',
  })
}

// إشعار تفعيل 2FA
export async function notify2FAEnabled(
  prisma: any,
  userId: string
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'TFA_ENABLED', {
    url: '/security',
  })
}

// إشعار تعطيل 2FA
export async function notify2FADisabled(
  prisma: any,
  userId: string,
  reason: string
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'TFA_DISABLED', {
    reason,
    url: '/security/2fa',
  })
}

// إشعار تغيير كلمة المرور
export async function notifyPasswordChanged(
  prisma: any,
  userId: string,
  details: { device: string; time: Date }
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'PASSWORD_CHANGED', {
    device: details.device,
    time: details.time.toISOString(),
    url: '/security',
  })
}

// إشعار نشاط مشبوه
export async function notifySuspiciousActivity(
  prisma: any,
  userId: string,
  activity: { type: string; severity: string; description: string }
): Promise<number> {
  const template = NOTIFICATION_TEMPLATES.SUSPICIOUS_ACTIVITY

  return sendPushNotificationToUser(prisma, userId, 'SUSPICIOUS_ACTIVITY', {
    type: activity.type,
    severity: activity.severity,
    description: activity.description,
    url: '/security',
  })
}

// إشعار إنهاء جلسة
export async function notifySessionTerminated(
  prisma: any,
  userId: string,
  details: { reason: string; device: string }
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'SESSION_TERMINATED', {
    reason: details.reason,
    device: details.device,
    url: '/security/sessions',
  })
}

// إشعار جهاز جديد
export async function notifyNewDevice(
  prisma: any,
  userId: string,
  details: { device: string; time: Date }
): Promise<number> {
  return sendPushNotificationToUser(prisma, userId, 'NEW_DEVICE', {
    device: details.device,
    time: details.time.toISOString(),
    url: '/security/devices',
  })
}

// تحديث ملف تسجيل الدخول ليشمل الإشعارات
export async function sendSecurityNotification(
  prisma: any,
  userId: string,
  type: string,
  data: Record<string, any>
): Promise<number> {
  const notificationMap: Record<string, (prisma: any, userId: string, data: any) => Promise<number>> = {
    'LOGIN_NEW': notifyNewLogin,
    'LOGIN_FAILED': notifyFailedLogin,
    'ACCOUNT_LOCKED': notifyAccountLocked,
    'TFA_ENABLED': notify2FAEnabled,
    'TFA_DISABLED': notify2FADisabled,
    'PASSWORD_CHANGED': notifyPasswordChanged,
    'SUSPICIOUS_ACTIVITY': notifySuspiciousActivity,
    'SESSION_TERMINATED': notifySessionTerminated,
    'NEW_DEVICE': notifyNewDevice,
  }

  const handler = notificationMap[type]
  if (!handler) {
    logError('Unknown notification type', { type })
    return 0
  }

  return handler(prisma, userId, data)
}
