import { NextRequest, NextResponse } from 'next/server'
import { authenticate, authorize } from '@/middleware/auth'
import { PermissionType } from '@/utils/permissions'
import { successResponse, errorResponse, unauthorizedResponse, validationProblem } from '@/utils/apiResponse'
import { logInfo } from '@/utils/logger'
import { withErrorHandler } from '@/utils/errorHandler'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح')
  }

  const body = await request.json()
  const { permission } = body

  if (!permission) {
    return validationProblem([{ field: 'permission', message: 'الصلاحية مطلوبة' }])
  }

  // Test the permission
  const hasPermission = authorize(user, permission as PermissionType)

  logInfo('Permission tested', {
    userId: user.userId,
    permission,
    hasPermission
  })

  return successResponse({
    permission,
    hasPermission,
    user: {
      id: user.userId,
      role: user.role,
      adminLevel: user.adminLevel
    }
  })
}, { method: 'POST', path: '/api/auth/test-permission' })
