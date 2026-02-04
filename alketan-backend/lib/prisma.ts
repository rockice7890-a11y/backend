import { PrismaClient } from '@prisma/client'

// إعدادات Connection Pool محسنة بناءً على البيئة
const getConnectionConfig = (): {
  connectionString: string | undefined
  connectionLimit: number
  poolTimeout: number
} => {
  const isProduction = process.env.NODE_ENV === 'production'
  
  return {
    connectionString: process.env.DATABASE_URL,
    connectionLimit: isProduction ? 10 : 2,
    poolTimeout: isProduction ? 20 : 10,
  }
}

// إنشاء Prisma Client مع الإعدادات المحسنة
const createPrismaClient = () => {
  const connectionConfig = getConnectionConfig()
  
  // التحقق من وجود DATABASE_URL
  const baseUrl = connectionConfig.connectionString || ''
  
  // دمج الإعدادات في DATABASE_URL
  let databaseUrl = baseUrl
  if (connectionConfig.connectionLimit !== 10 && baseUrl) {
    const separator = baseUrl.includes('?') ? '&' : '?'
    databaseUrl = `${baseUrl}${separator}connection_limit=${connectionConfig.connectionLimit}&pool_timeout=${connectionConfig.poolTimeout}`
  }
  
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl || undefined,
      },
    },
    log: process.env.NODE_ENV === 'development' 
      ? ['error', 'warn'] 
      : ['error'],
  })
}

// استخدام Singleton Pattern لمنع إنشاء اتصال جديد في كل hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// إنشاء Prisma Client
export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// دالة للحصول على Prisma Client
export function getPrismaClient() {
  return prisma
}

// دالة للتحقق من حالة الاتصال
export async function checkPrismaConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (error) {
    console.error('Prisma connection check failed:', error)
    return false
  }
}

// دالة لإغلاق الاتصال يدوياً
export async function disconnectPrisma() {
  await prisma.$disconnect()
}
