import { notificationQueue } from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { logInfo, logError } from '@/utils/logger'

// معالج إرسال الإشعارات
notificationQueue.process('send-notification', async (job) => {
  const { userId, title, message, type, link } = job.data

  try {
    logInfo(`Processing notification job ${job.id}`, { userId, title })

    // إنشاء إشعار في قاعدة البيانات
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        link,
      },
    })

    // هنا يمكنك إرسال Push Notification
    // await sendPushNotification(userId, { title, message, link })
    
    logInfo(`Notification created successfully`, { notificationId: notification.id })
    
    return { success: true, notificationId: notification.id }
  } catch (error) {
    logError(`Failed to create notification`, error, { jobId: job.id, userId })
    throw error
  }
})

// معالج إرسال إشعارات الحجوزات
notificationQueue.process('booking-notification', async (job) => {
  const { bookingId, userId, notificationType } = job.data

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        hotel: { select: { name: true } },
        room: { select: { number: true } },
      },
    })

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`)
    }

    let title = ''
    let message = ''

    switch (notificationType) {
      case 'confirmed':
        title = 'تم تأكيد حجزك'
        message = `تم تأكيد حجزك في ${booking.hotel.name}`
        break
      case 'check-in':
        title = 'موعد تسجيل الدخول'
        message = `موعد تسجيل دخولك في ${booking.hotel.name} هو اليوم`
        break
      case 'check-out':
        title = 'موعد تسجيل الخروج'
        message = `موعد تسجيل خروجك من ${booking.hotel.name} هو اليوم`
        break
      case 'cancelled':
        title = 'تم إلغاء الحجز'
        message = `تم إلغاء حجزك في ${booking.hotel.name}`
        break
    }

    await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type: 'booking',
        link: `/bookings/${bookingId}`,
      },
    })

    return { success: true, bookingId }
  } catch (error) {
    logError(`Failed to send booking notification`, error, { bookingId })
    throw error
  }
})

