import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/middleware/auth'
import { AdminLevel } from '@prisma/client'
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, paginatedResponse } from '@/utils/apiResponse'
import { withErrorHandler } from '@/utils/errorHandler'

const handleGet = async (request: NextRequest): Promise<NextResponse> => {
  const user = await authenticate(request)
  if (!user) {
    return unauthorizedResponse('غير مصرح لك')
  }

  if (user.adminLevel !== AdminLevel.SUPER_ADMIN) {
    return forbiddenResponse('ليس لديك صلاحية لعرض سجلات النظام')
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const action = searchParams.get('action')
  const ip = searchParams.get('ip')
  const userId = searchParams.get('userId')

  const where: any = {}
  if (action) where.action = { contains: action, mode: 'insensitive' }
  if (ip) where.ipAddress = { contains: ip }
  if (userId) where.userId = userId

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true
          }
        }
      }
    }),
    prisma.auditLog.count({ where })
  ])

  return paginatedResponse(logs, total, page, limit, {
    message: 'تم جلب سجلات المراقبة بنجاح'
  })
}

export const GET = withErrorHandler(handleGet, { method: 'GET', path: '/api/admin/monitoring/logs' })
