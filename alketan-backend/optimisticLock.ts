import { prisma } from '@/lib/prisma'
import { conflictResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'

// نوع الخطأ لـ Optimistic Locking
export const OPTIMISTIC_LOCK_ERROR = 'OPTIMISTIC_LOCK_ERROR'

// واجهة للنتيجة مع معلومات version
export interface OptimisticLockResult<T> {
  success: boolean
  data?: T
  conflict?: {
    currentVersion: number
    currentStatus: string
    currentPaymentStatus?: string
    lastUpdated: string | null
  }
  error?: NextResponse
}

/**
 * التحقق من Optimistic Locking قبل التحديث
 * @param id - معرف السجل
 * @param expectedVersion - الإصدار المتوقع
 * @param modelName - اسم النموذج (مثل 'booking', 'user')
 * @returns النتيجة مع البيانات أو معلومات الصراع
 */
export async function checkOptimisticLock<T extends { id: string; version: number; status: any; paymentStatus?: any; updatedAt?: Date | null }>(
  id: string,
  expectedVersion: number,
  modelName: 'booking' | 'user' | 'hotel' | 'room' | 'invoice'
): Promise<{
  current: T | null
  isConflict: boolean
}> {
  const model = prisma[modelName as keyof typeof prisma] as any
  if (!model) {
    throw new Error(`Model ${modelName} not found`)
  }

  const current = await model.findUnique({
    where: { id },
    select: {
      id: true,
      version: true,
      status: true,
      paymentStatus: true,
      updatedAt: true,
    },
  })

  if (!current) {
    return { current: null, isConflict: false }
  }

  const isConflict = expectedVersion !== undefined && current.version !== expectedVersion

  return { current, isConflict }
}

/**
 * تنفيذ تحديث مع Optimistic Locking
 * @param modelName - اسم النموذج
 * @param id - معرف السجل
 * @param data - البيانات المراد تحديثها
 * @param expectedVersion - الإصدار المتوقع (اختياري)
 * @returns النتيجة
 */
export async function updateWithOptimisticLock<T>(
  modelName: 'booking' | 'user' | 'hotel' | 'room' | 'invoice',
  id: string,
  data: Record<string, any>,
  expectedVersion?: number
): Promise<OptimisticLockResult<T>> {
  const model = prisma[modelName as keyof typeof prisma] as any
  if (!model) {
    throw new Error(`Model ${modelName} not found`)
  }

  // إذا تم تحديد expectedVersion، تحقق من الصراع أولاً
  if (expectedVersion !== undefined) {
    const { current, isConflict } = await checkOptimisticLock(id, expectedVersion, modelName)
    
    if (isConflict && current) {
      return {
        success: false,
        conflict: {
          currentVersion: current.version,
          currentStatus: current.status,
          currentPaymentStatus: current.paymentStatus,
          lastUpdated: current.updatedAt?.toISOString() || null,
        },
        error: conflictResponse(
          `تم تعديل هذا ${modelName} من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.`,
          {
            details: {
              currentVersion: current.version,
              currentStatus: current.status,
              currentPaymentStatus: current.paymentStatus,
              lastUpdated: current.updatedAt?.toISOString() || null,
            }
          }
        ),
      }
    }
  }

  // إضافة version increment
  const updateData = {
    ...data,
    version: { increment: 1 },
  }

  try {
    const result = await model.update({
      where: { id },
      data: updateData,
    })

    return {
      success: true,
      data: result as T,
    }
  } catch (error: any) {
    if (error.code === 'P2025') {
      // السجل غير موجود
      return {
        success: false,
        error: conflictResponse(`لم يتم العثور على ${modelName}`),
      }
    }
    throw error
  }
}

/**
 * حذف مع Optimistic Locking
 * @param modelName - اسم النموذج
 * @param id - معرف السجل
 * @param expectedVersion - الإصدار المتوقع
 * @returns النتيجة
 */
export async function deleteWithOptimisticLock(
  modelName: 'booking' | 'user' | 'hotel' | 'room' | 'invoice',
  id: string,
  expectedVersion?: number
): Promise<OptimisticLockResult<any>> {
  const model = prisma[modelName as keyof typeof prisma] as any
  if (!model) {
    throw new Error(`Model ${modelName} not found`)
  }

  // إذا تم تحديد expectedVersion، تحقق من الصراع أولاً
  if (expectedVersion !== undefined) {
    const { current, isConflict } = await checkOptimisticLock(id, expectedVersion, modelName)
    
    if (isConflict && current) {
      return {
        success: false,
        conflict: {
          currentVersion: current.version,
          currentStatus: current.status,
          currentPaymentStatus: current.paymentStatus,
          lastUpdated: current.updatedAt?.toISOString() || null,
        },
        error: conflictResponse(
          `تم تعديل هذا ${modelName} من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.`,
          {
            details: {
              currentVersion: current.version,
              currentStatus: current.status,
              currentPaymentStatus: current.paymentStatus,
              lastUpdated: current.updatedAt?.toISOString() || null,
            }
          }
        ),
      }
    }
  }

  try {
    const result = await model.delete({
      where: { id },
    })

    return {
      success: true,
      data: result,
    }
  } catch (error: any) {
    if (error.code === 'P2025') {
      return {
        success: false,
        error: conflictResponse(`لم يتم العثور على ${modelName}`),
      }
    }
    throw error
  }
}

/**
 * إنشاء استجابة خطأ للصراع في Optimistic Locking
 */
export function createOptimisticLockConflictResponse(
  currentVersion: number,
  currentStatus: string,
  currentPaymentStatus?: string,
  lastUpdated?: string | null
): NextResponse {
  return conflictResponse(
    'تم تعديل هذا السجل من قبل مستخدم آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.',
    {
      details: {
        currentVersion,
        currentStatus,
        currentPaymentStatus,
        lastUpdated,
        code: OPTIMISTIC_LOCK_ERROR,
      },
    }
  )
}
