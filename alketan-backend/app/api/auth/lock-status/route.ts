import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse, validationProblem } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json()
  const email = body.email

  if (!email) {
    return validationProblem([{ field: 'email', message: 'البريد الإلكتروني مطلوب' }])
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      lockoutUntil: true,
      failedLoginAttempts: true,
    }
  })

  if (!user) {
    return successResponse({
      isLocked: false,
      attempts: 0,
      remainingTime: 0
    })
  }

  const now = new Date()
  const isLocked = user.lockoutUntil && user.lockoutUntil > now
  const remainingTime = isLocked
    ? Math.ceil((user.lockoutUntil!.getTime() - now.getTime()) / 1000 / 60) // بالدقائق
    : 0

  return successResponse({
    isLocked,
    attempts: user.failedLoginAttempts || 0,
    remainingTime,
    lockUntil: user.lockoutUntil,
    reason: null
  })
}, { method: 'POST', path: '/api/auth/lock-status' })
