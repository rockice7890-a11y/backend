import { NextResponse } from 'next/server'

/**
 * هيكل استجابة API موحد لجميع العمليات
 */
export interface ApiResponse<T = any> {
    success: boolean
    data?: T
    error?: {
        code?: string
        message: string
        details?: any
    }
    meta?: {
        page?: number
        limit?: number
        total?: number
        totalPages?: number
        [key: string]: any
    }
    timestamp: string
}

/**
 * وظيفة مساعدة لإنشاء استجابة نجاح باستخدام NextResponse
 */
export function successResponse<T>(
    data: T,
    meta?: ApiResponse['meta'],
    status: number = 200
): NextResponse {
    const body: ApiResponse<T> = {
        success: true,
        data,
        meta,
        timestamp: new Date().toISOString(),
    }
    return NextResponse.json(body, { status })
}

/**
 * وظيفة مساعدة لإنشاء استجابة خطأ باستخدام NextResponse
 */
export function errorResponse(
    message: string,
    status: number = 400,
    code?: string,
    details?: any
): NextResponse {
    const body: ApiResponse = {
        success: false,
        error: {
            message,
            code,
            details,
        },
        timestamp: new Date().toISOString(),
    }
    return NextResponse.json(body, { status })
}
