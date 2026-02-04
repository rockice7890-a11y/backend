import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { successResponse, errorResponse, unauthorizedResponse, notFoundResponse, validationProblem } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handlePost = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  const body = await request.json()
  const { code, hotelId, amount } = body

  if (!code) {
    return validationProblem([{ field: 'code', message: 'كود الخصم مطلوب' }])
  }

  if (!amount || amount <= 0) {
    return validationProblem([{ field: 'amount', message: 'المبلغ مطلوب' }])
  }

  // البحث عن كود الخصم
  const discount = await prisma.discount.findUnique({
    where: { code },
  })

  if (!discount) {
    return notFoundResponse('كود الخصم غير صحيح')
  }

  // التحقق من أن الخصم نشط
  if (!discount.isActive) {
    return errorResponse('BAD_REQUEST', 'كود الخصم غير نشط')
  }

  // التحقق من تاريخ الصلاحية
  const now = new Date()
  if (now < discount.startDate || now > discount.endDate) {
    return errorResponse('BAD_REQUEST', 'كود الخصم منتهي الصلاحية')
  }

  // التحقق من أن الخصم خاص بالفندق (إذا كان hotelId محدد)
  if (discount.hotelId && hotelId && discount.hotelId !== hotelId) {
    return errorResponse('BAD_REQUEST', 'كود الخصم غير صالح لهذا الفندق')
  }

  // التحقق من حد الاستخدام
  if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
    return errorResponse('BAD_REQUEST', 'تم تجاوز حد استخدام كود الخصم')
  }

  // التحقق من الحد الأدنى للمبلغ
  if (discount.minAmount && amount < discount.minAmount) {
    return errorResponse('BAD_REQUEST', `الحد الأدنى للمبلغ هو ${discount.minAmount}`)
  }

  // حساب قيمة الخصم
  let discountValue = 0
  if (discount.type === 'percentage') {
    discountValue = (amount * discount.value) / 100
    if (discount.maxDiscount) {
      discountValue = Math.min(discountValue, discount.maxDiscount)
    }
  } else {
    discountValue = discount.value
  }

  return successResponse({
    valid: true,
    discount: {
      id: discount.id,
      code: discount.code,
      name: discount.name,
      type: discount.type,
      value: discount.value,
      discountAmount: discountValue,
      finalAmount: amount - discountValue,
    },
  })
}

export const POST = withErrorHandler(handlePost, { method: 'POST', path: '/api/discounts/validate' })
