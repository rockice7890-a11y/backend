import Bull from 'bull'
import Redis from 'ioredis'
import { logInfo, logError } from '@/utils/logger'

// إعداد Redis للـ Queue
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
}

// إنشاء Queues
export const emailQueue = new Bull('email', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600, // حذف المهام المكتملة بعد 24 ساعة
      count: 1000, // الاحتفاظ بآخر 1000 مهمة
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // حذف المهام الفاشلة بعد 7 أيام
    },
  },
})

export const notificationQueue = new Bull('notifications', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
})

export const paymentQueue = new Bull('payments', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
})

export const reportQueue = new Bull('reports', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 60000, // 1 دقيقة
    },
  },
})

// Event Handlers
emailQueue.on('completed', (job) => {
  logInfo(`Email job ${job.id} completed`, { jobId: job.id, data: job.data })
})

emailQueue.on('failed', (job, err) => {
  logError(`Email job ${job?.id} failed`, err, { jobId: job?.id, data: job?.data })
})

notificationQueue.on('completed', (job) => {
  logInfo(`Notification job ${job.id} completed`, { jobId: job.id })
})

notificationQueue.on('failed', (job, err) => {
  logError(`Notification job ${job?.id} failed`, err, { jobId: job?.id })
})

// Helper Functions
export async function addEmailJob(data: {
  to: string
  subject: string
  template: string
  variables?: Record<string, any>
}) {
  return await emailQueue.add('send-email', data, {
    priority: 1,
  })
}

export async function addNotificationJob(data: {
  userId: string
  title: string
  message: string
  type: string
  link?: string
}) {
  return await notificationQueue.add('send-notification', data, {
    priority: 1,
  })
}

export async function addPaymentJob(data: {
  bookingId: string
  amount: number
  method: string
}) {
  return await paymentQueue.add('process-payment', data, {
    priority: 5, // أولوية عالية
  })
}

export async function addReportJob(data: {
  type: string
  hotelId?: string
  startDate: Date
  endDate: Date
}) {
  return await reportQueue.add('generate-report', data, {
    priority: 3,
  })
}

