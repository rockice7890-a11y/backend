/**
 * أداة مراقبة أمان الحساب
 * Account Security Monitoring Utility
 */

import { prisma } from '@/lib/prisma'
import { logWarn, logInfo, logError } from '@/utils/logger'

// واجهة معلومات الجهاز
export interface DeviceInfo {
  ip: string
  userAgent: string
  deviceType: string
  browser: string
  os: string
  location?: string
}

// واجهة النشاط المشبوه
export interface SuspiciousActivity {
  type: 'new_device' | 'new_location' | 'multiple_locations' | 'unusual_time' | 'rapid_movement'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  details: Record<string, any>
}

// إعداد حدود الأمان
export const SECURITY_THRESHOLDS = {
  MAX_DEVICES: 5,
  MAX_LOGINS_PER_DAY: 10,
  NEW_LOCATION_ALERT: true,
  NEW_DEVICE_ALERT: true,
  TIME_WINDOW_HOURS: 24,
  DISTANCE_THRESHOLD_KM: 500, // للحد rapid movement
}

/**
 * استخراج معلومات الموقع من عنوان IP
 */
export async function getLocationFromIP(ip: string): Promise<string | null> {
  // في الإنتاج، استخدم خدمة مثل MaxMind أو IPinfo
  // هذا تنفيذ مبسط للتوضيح
  try {
    // تجاهل عناوين IP المحلية
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return 'Local Network'
    }

    // محاكاة استخراج الموقع (في الإنتاج، استدعاء API حقيقي)
    return 'Unknown Location'
  } catch (error) {
    return null
  }
}

/**
 * تحليل معلومات الجهاز
 */
export function parseDeviceInfo(userAgent: string): {
  deviceType: string
  browser: string
  os: string
} {
  let deviceType = 'Unknown'
  let browser = 'Unknown'
  let os = 'Unknown'

  // تحديد نوع الجهاز
  if (/mobile/i.test(userAgent)) {
    deviceType = 'Mobile'
  } else if (/tablet/i.test(userAgent)) {
    deviceType = 'Tablet'
  } else if (/desktop|computer|pc/i.test(userAgent)) {
    deviceType = 'Desktop'
  }

  // تحديد المتصفح
  if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) {
    browser = 'Chrome'
  } else if (/firefox/i.test(userAgent)) {
    browser = 'Firefox'
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    browser = 'Safari'
  } else if (/edge/i.test(userAgent)) {
    browser = 'Edge'
  } else if (/msie|trident/i.test(userAgent)) {
    browser = 'Internet Explorer'
  }

  // تحديد نظام التشغيل
  if (/windows/i.test(userAgent)) {
    os = 'Windows'
  } else if (/macintosh|mac os/i.test(userAgent)) {
    os = 'macOS'
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux'
  } else if (/android/i.test(userAgent)) {
    os = 'Android'
  } else if (/iphone|ipad|ios/i.test(userAgent)) {
    os = 'iOS'
  }

  return { deviceType, browser, os }
}

/**
 * إنشاء بصمة الجهاز
 */
export function createDeviceFingerprint(deviceInfo: DeviceInfo): string {
  const data = `${deviceInfo.deviceType}-${deviceInfo.browser}-${deviceInfo.os}`
  return data
}

/**
 * التحقق من الجهاز الجديد
 */
async function checkNewDevice(
  userId: string,
  deviceInfo: DeviceInfo
): Promise<SuspiciousActivity | null> {
  const fingerprint = createDeviceFingerprint(deviceInfo)

  const existingDevice = await prisma.userDevice.findFirst({
    where: {
      userId,
      isActive: true,
    },
  })

  // التحقق من البصمة يدوياً إذا كان الجهاز موجوداً
  const deviceWithFingerprint = existingDevice as any
  if (deviceWithFingerprint && deviceWithFingerprint.deviceFingerprint !== fingerprint) {
    return {
      type: 'new_device',
      severity: 'medium',
      description: 'تسجيل دخول من جهاز جديد',
      details: {
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ip: deviceInfo.ip,
      },
    }
  }

  return null
}

/**
 * التحقق من الموقع الجغرافي الجديد
 */
async function checkNewLocation(
  userId: string,
  deviceInfo: DeviceInfo
): Promise<SuspiciousActivity | null> {
  if (!deviceInfo.ip) return null

  const location = await getLocationFromIP(deviceInfo.ip)
  if (!location || location === 'Local Network') return null

  // جلب آخر عمليات تسجيل الدخول
  const recentLogins = await prisma.sessionLog.findMany({
    where: {
      userId,
      loginAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // آخر 30 يوم
      },
    },
    orderBy: { loginAt: 'desc' },
    take: 10,
  })

  // استخراج المواقع المختلفة
  const locations = new Set<string>()
  for (const login of recentLogins) {
    if (login.ipAddress) {
      const loc = await getLocationFromIP(login.ipAddress)
      if (loc) locations.add(loc)
    }
  }

  if (!locations.has(location)) {
    return {
      type: 'new_location',
      severity: 'high',
      description: 'تسجيل دخول من موقع جغرافي جديد',
      details: {
        location,
        previousLocations: Array.from(locations).slice(0, 5),
        ip: deviceInfo.ip,
      },
    }
  }

  return null
}

/**
 * التحقق من تسجيل دخول من مواقع متعددة في وقت قصير
 */
async function checkMultipleLocations(
  userId: string,
  deviceInfo: DeviceInfo
): Promise<SuspiciousActivity | null> {
  const timeWindow = Date.now() - 2 * 60 * 60 * 1000 // ساعتان

  const recentLogins = await prisma.sessionLog.findMany({
    where: {
      userId,
      loginAt: {
        gte: new Date(timeWindow),
      },
    },
    orderBy: { loginAt: 'desc' },
  })

  // تجميع المواقع
  const locationMap = new Map<string, number>()
  for (const login of recentLogins) {
    if (login.ipAddress) {
      const loc = await getLocationFromIP(login.ipAddress)
      if (loc) {
        locationMap.set(loc, (locationMap.get(loc) || 0) + 1)
      }
    }
  }

  // إذا كان هناك أكثر من موقعين مختلفين في وقت قصير
  if (locationMap.size >= 2) {
    const locations = Array.from(locationMap.entries())
    const locationsStr = locations.map(([loc, count]) => `${loc} (${count})`).join(', ')

    return {
      type: 'multiple_locations',
      severity: 'critical',
      description: 'تسجيل دخول من مواقع جغرافية متعددة في وقت قصير',
      details: {
        locations: locationsStr,
        loginCount: recentLogins.length,
        timeWindow: '2 hours',
      },
    }
  }

  return null
}

/**
 * التحقق من الوقت غير المعتاد لتسجيل الدخول
 */
function checkUnusualTime(
  userId: string,
  deviceInfo: DeviceInfo
): SuspiciousActivity | null {
  const now = new Date()
  const hour = now.getHours()

  // تسجيل الدخول بين منتصف الليل والساعة 5 صباحاً يُعتبر غير معتاد
  if (hour >= 0 && hour < 5) {
    return {
      type: 'unusual_time',
      severity: 'low',
      description: 'تسجيل دخول في وقت متأخر من الليل',
      details: {
        loginHour: hour,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }
  }

  return null
}

/**
 * تحليل شامل لنشاط الأمان
 */
export async function analyzeSecurityActivity(
  userId: string,
  deviceInfo: DeviceInfo
): Promise<SuspiciousActivity[]> {
  const activities: SuspiciousActivity[] = []

  // التحقق من الجهاز الجديد
  const newDeviceActivity = await checkNewDevice(userId, deviceInfo)
  if (newDeviceActivity) activities.push(newDeviceActivity)

    // التحقق من الموقع الجديد
    const newLocationActivity = await checkNewLocation(userId, deviceInfo)
    if (newLocationActivity) activities.push(newLocationActivity)

  // التحقق من المواقع المتعددة
  const multipleLocationsActivity = await checkMultipleLocations(userId, deviceInfo)
  if (multipleLocationsActivity) activities.push(multipleLocationsActivity)

  // التحقق من الوقت
  const unusualTimeActivity = checkUnusualTime(userId, deviceInfo)
  if (unusualTimeActivity) activities.push(unusualTimeActivity)

  return activities
}

/**
 * إضافة جهاز جديد للمستخدم
 */
export async function addUserDevice(
  userId: string,
  deviceId: string,
  deviceType: string,
  pushToken?: string
): Promise<void> {
  try {
    // التحقق من عدد الأجهزة
    const deviceCount = await prisma.userDevice.count({
      where: { userId, isActive: true },
    })

    // إذا وصل للحد الأقصى، إلغاء تنشيط أقدم جهاز
    if (deviceCount >= SECURITY_THRESHOLDS.MAX_DEVICES) {
      const oldestDevice = await prisma.userDevice.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'asc' },
      })

      if (oldestDevice) {
        await prisma.userDevice.update({
          where: { id: oldestDevice.id },
          data: { isActive: false },
        })

        logInfo('Deactivated oldest device due to limit', {
          userId,
          deviceId: oldestDevice.deviceId,
        })
      }
    }

    // إضافة أو تحديث الجهاز
    await prisma.userDevice.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      create: {
        userId,
        deviceId,
        deviceType,
        pushToken,
        isActive: true,
      },
      update: {
        deviceType,
        pushToken,
        isActive: true,
        updatedAt: new Date(),
      },
    })

  } catch (error) {
    logError('Error adding user device', { error, userId, deviceId })
  }
}

/**
 * إدارة جلسة المستخدم
 */
export async function getUserActiveSessions(userId: string) {
  return prisma.sessionLog.findMany({
    where: {
      userId,
      logoutAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: { loginAt: 'desc' },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      deviceFingerprint: true,
      loginAt: true,
      expiresAt: true,
    },
  })
}

/**
 * إنهاء جلسة معينة
 */
export async function terminateSession(sessionId: string, userId: string): Promise<boolean> {
  try {
    const result = await prisma.sessionLog.updateMany({
      where: {
        id: sessionId,
        userId,
        logoutAt: null,
      },
      data: {
        logoutAt: new Date(),
      },
    })

    return (result.count ?? 0) > 0
  } catch (error) {
    logError('Error terminating session', { error, sessionId, userId })
    return false
  }
}

/**
 * إنهاء جميع الجلسات الأخرى
 */
export async function terminateOtherSessions(
  currentSessionId: string,
  userId: string
): Promise<number> {
  try {
    const result = await prisma.sessionLog.updateMany({
      where: {
        userId,
        logoutAt: null,
        id: { not: currentSessionId },
      },
      data: {
        logoutAt: new Date(),
      },
    })

    return result.count ?? 0
  } catch (error) {
    logError('Error terminating other sessions', { error, userId })
    return 0
  }
}
