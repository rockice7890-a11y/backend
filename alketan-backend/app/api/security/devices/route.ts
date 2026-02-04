import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { successResponse, errorResponse, validationProblem, unauthorizedResponse } from '@/utils/apiResponse'
import { createAuditLog } from '@/utils/auditLogger'
import { parseDeviceInfo, createDeviceFingerprint } from '@/utils/securityMonitor'
import { notifyNewDevice } from '@/utils/pushNotifications'
import { withErrorHandler } from '@/utils/errorHandler'

// GET: جلب جميع الأجهزة
export const GET = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const includeInactive = searchParams.get('includeInactive') === 'true'

  const devices = await prisma.userDevice.findMany({
    where: {
      userId: user.userId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: { lastLogin: 'desc' },
  })

  // تحليل معلومات الجهاز لكل جهاز
  const devicesWithInfo = await Promise.all(
    devices.map(async (device) => {
      const lastSession = await prisma.sessionLog.findFirst({
        where: {
          userId: user.userId,
          deviceFingerprint: createDeviceFingerprint({
            ip: device.id,
            userAgent: device.deviceType,
            deviceType: 'Unknown',
            browser: 'Unknown',
            os: 'Unknown',
          }),
        },
        orderBy: { loginAt: 'desc' },
      })

      return {
        id: device.id,
        deviceId: device.deviceId,
        deviceType: device.deviceType,
        pushToken: !!device.pushToken,
        isActive: device.isActive,
        createdAt: device.createdAt,
        lastLogin: device.lastLogin || device.updatedAt,
        isCurrent: false,
      }
    })
  )

  return successResponse({
    devices: devicesWithInfo,
    totalDevices: devicesWithInfo.length,
    activeDevices: devicesWithInfo.filter((d) => d.isActive).length,
  })
}, { method: 'GET', path: '/api/security/devices' })

// POST: إضافة جهاز جديد
export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const body = await request.json()
  const { deviceId, deviceType, pushToken, userAgent } = body

  // التحقق من المدخلات
  if (!deviceId || !deviceType) {
    return validationProblem([
      { field: 'deviceId', message: 'معرف الجهاز مطلوب' },
      { field: 'deviceType', message: 'نوع الجهاز مطلوب' },
    ])
  }

  // التحقق من حد الأجهزة
  const activeDevices = await prisma.userDevice.count({
    where: { userId: user.userId, isActive: true },
  })

  if (activeDevices >= 10) {
    // إلغاء تنشيط أقدم جهاز إذا وصل للحد الأقصى
    const oldestDevice = await prisma.userDevice.findFirst({
      where: { userId: user.userId, isActive: true },
      orderBy: { createdAt: 'asc' },
    })

    if (oldestDevice) {
      await prisma.userDevice.update({
        where: { id: oldestDevice.id },
        data: { isActive: false },
      })

      await createAuditLog({
        userId: user.userId,
        action: 'DEVICE_DEACTIVATED_AUTO',
        resource: 'security',
        details: {
          deviceId: oldestDevice.deviceId,
          reason: 'max_devices_reached',
        },
      })
    }
  }

  // إضافة أو تحديث الجهاز
  const device = await prisma.userDevice.upsert({
    where: {
      userId_deviceId: {
        userId: user.userId,
        deviceId,
      },
    },
    create: {
      userId: user.userId,
      deviceId,
      deviceType,
      pushToken,
      isActive: true,
      lastLogin: new Date(),
    },
    update: {
      deviceType,
      pushToken,
      isActive: true,
      lastLogin: new Date(),
      updatedAt: new Date(),
    },
  })

  // إرسال إشعار
  await notifyNewDevice(prisma, user.userId, {
    device: deviceType,
    time: new Date(),
  })

  // تسجيل في التدقيق
  await createAuditLog({
    userId: user.userId,
    action: 'DEVICE_ADDED',
    resource: 'security',
    details: {
      deviceId,
      deviceType,
    },
  })

  return successResponse({
    message: 'تم إضافة الجهاز بنجاح',
    device: {
      id: device.id,
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      isActive: device.isActive,
      createdAt: device.createdAt,
    },
  })
}, { method: 'POST', path: '/api/security/devices' })

// DELETE: حذف أو إلغاء تنشيط جهاز
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get('deviceId')
  const permanent = searchParams.get('permanent') === 'true'

  if (!deviceId) {
    return validationProblem([{ field: 'deviceId', message: 'معرف الجهاز مطلوب' }])
  }

  // البحث عن الجهاز
  const device = await prisma.userDevice.findFirst({
    where: {
      userId: user.userId,
      deviceId,
    },
  })

  if (!device) {
    return errorResponse('NOT_FOUND', 'الجهاز غير موجود')
  }

  if (permanent) {
    // حذف نهائي
    await prisma.userDevice.delete({
      where: { id: device.id },
    })

    await createAuditLog({
      userId: user.userId,
      action: 'DEVICE_DELETED',
      resource: 'security',
      details: {
        deviceId,
        deviceType: device.deviceType,
      },
    })

    return successResponse({
      message: 'تم حذف الجهاز نهائياً',
    })
  } else {
    // إلغاء تنشيط
    await prisma.userDevice.update({
      where: { id: device.id },
      data: { isActive: false },
    })

    await createAuditLog({
      userId: user.userId,
      action: 'DEVICE_DEACTIVATED',
      resource: 'security',
      details: {
        deviceId,
        deviceType: device.deviceType,
      },
    })

    return successResponse({
      message: 'تم إلغاء تنشيط الجهاز',
    })
  }
}, { method: 'DELETE', path: '/api/security/devices' })

// PATCH: تحديث معلومات الجهاز
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('يرجى تسجيل الدخول أولاً')
  }
  const body = await request.json()
  const { deviceId, pushToken, userAgent } = body

  if (!deviceId) {
    return validationProblem([{ field: 'deviceId', message: 'معرف الجهاز مطلوب' }])
  }

  const device = await prisma.userDevice.findFirst({
    where: {
      userId: user.userId,
      deviceId,
    },
  })

  if (!device) {
    return errorResponse('NOT_FOUND', 'الجهاز غير موجود')
  }

  await prisma.userDevice.update({
    where: { id: device.id },
    data: {
      pushToken,
      deviceType: userAgent || device.deviceType,
      lastLogin: new Date(),
      updatedAt: new Date(),
    },
  })

  return successResponse({
    message: 'تم تحديث الجهاز بنجاح',
  })
}, { method: 'PATCH', path: '/api/security/devices' })
