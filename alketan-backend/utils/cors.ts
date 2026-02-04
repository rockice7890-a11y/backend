import { NextRequest, NextResponse } from 'next/server';

// إعدادات CORS - يمكن تخصيصها حسب البيئة
const CORS_CONFIG = {
  // السماح بالمصادر (Origins) المختلفة
  allowedOrigins: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL || 'https://your-domain.com']
    : [
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://localhost:3002',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
      ],
  
  //_methods المسموح بها
  allowedMethods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],
  
  // Headers المسموح بها
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-csrf-token',
    'x-user-id',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
  ],
  
  // Headers التي يمكن للعميل قراءتها
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-CSRF-Token',
  ],
  
  // هل يجب السماح بالكوكيز
  allowCredentials: true,
  
  // مدة التخزين المؤقت (بالثواني)
  maxAge: 86400, // 24 hours
};

/**
 * دالة للتحقق إذا كان الأصل (Origin) مسموح به
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  
  // التحقق من قائمة المصادر المسموح بها
  if (CORS_CONFIG.allowedOrigins.includes(origin)) {
    return true;
  }
  
  // للسماح بأي أصل في بيئة التطوير
  if (process.env.NODE_ENV !== 'production') {
    // السماح بأي localhost
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }
  }
  
  return false;
}

/**
 * دالة لتطبيق رؤوس CORS على الاستجابة
 */
export function applyCorsHeaders(response: NextResponse, requestOrigin: string | null): NextResponse {
  // إذا كان الأصل مسموح به، نطبقه
  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    response.headers.set('Access-Control-Allow-Origin', requestOrigin);
  }
  
  //_methods المسموح بها
  response.headers.set('Access-Control-Allow-Methods', CORS_CONFIG.allowedMethods.join(', '));
  
  //_headers المسموح بها
  response.headers.set('Access-Control-Allow-Headers', CORS_CONFIG.allowedHeaders.join(', '));
  
  //_headers المكشوفة
  response.headers.set('Access-Control-Expose-Headers', CORS_CONFIG.exposedHeaders.join(', '));
  
  // السماح بالـ Credentials
  if (CORS_CONFIG.allowCredentials) {
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  
  // مدة التخزين المؤقت لـ preflight
  response.headers.set('Access-Control-Max-Age', CORS_CONFIG.maxAge.toString());
  
  return response;
}

/**
 * معالجة طلبات OPTIONS (preflight requests)
 */
export function handleCorsPreflight(request: NextRequest): NextResponse {
  const requestOrigin = request.headers.get('origin');
  
  // إنشاء استجابة فارغة
  const response = new NextResponse(null, {
    status: 204,
  });
  
  return applyCorsHeaders(response, requestOrigin);
}

/**
 * Middleware للتحقق من CORS وتطبيق الرؤوس
 */
export function corsMiddleware(request: NextRequest): NextResponse | null {
  const requestOrigin = request.headers.get('origin');
  
  // إذا لم يكن هناك أصل في الطلب، لا نطبق CORS
  if (!requestOrigin) {
    return null;
  }
  
  // إذا كان الأصل غير مسموح به، نرفض الطلب
  if (!isOriginAllowed(requestOrigin)) {
    return new NextResponse(JSON.stringify({
      success: false,
      message: 'Origin not allowed',
      code: 'CORS_ERROR',
    }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  
  return null;
}
