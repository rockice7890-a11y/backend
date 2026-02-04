import winston from 'winston'

// تنسيق الـ Logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
)

// تنسيق للـ Console (أسهل للقراءة في Development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`
    }
    return msg
  })
)

// التحقق مما إذا كنا في Edge Runtime
const isEdge = process.env.NEXT_RUNTIME === 'edge'

// إنشاء Logger - متوافق مع Edge Runtime (لا نقوم بإنشاء winston logger في Edge)
export const logger = !isEdge
  ? winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'hotel-api' },
    transports: [
      new winston.transports.Console({
        format: consoleFormat,
      }),
    ],
  })
  : null

// Helper functions للاستخدام السهل مع Fallback للـ Console في Edge
export const logInfo = (message: string, meta?: any) => {
  if (logger) {
    logger.info(message, meta)
  } else {
    console.log(`[INFO] ${message}`, meta || '')
  }
}

export const logError = (message: string, error?: any, meta?: any) => {
  if (logger) {
    logger.error(message, {
      error: error?.message,
      stack: error?.stack,
      ...meta,
    })
  } else {
    console.error(`[ERROR] ${message}`, error?.message || error || '', meta || '')
  }
}

export const logWarn = (message: string, meta?: any) => {
  if (logger) {
    logger.warn(message, meta)
  } else {
    console.warn(`[WARN] ${message}`, meta || '')
  }
}

export const logDebug = (message: string, meta?: any) => {
  if (logger) {
    logger.debug(message, meta)
  } else {
    console.debug(`[DEBUG] ${message}`, meta || '')
  }
}

// Logging للـ API Requests
export const logRequest = (method: string, path: string, userId?: string, meta?: any) => {
  if (logger) {
    logger.info('API Request', {
      method,
      path,
      userId,
      ...meta,
      timestamp: new Date().toISOString(),
    })
  } else {
    console.log(`[REQUEST] ${method} ${path}`, { userId, ...meta })
  }
}

// Logging للـ API Errors
export const logApiError = (
  method: string,
  path: string,
  error: any,
  userId?: string,
  statusCode?: number
) => {
  if (logger) {
    logger.error('API Error', {
      method,
      path,
      userId,
      statusCode,
      error: error?.message,
      stack: error?.stack,
      timestamp: new Date().toISOString(),
    })
  } else {
    console.error(`[API ERROR] ${method} ${path}`, {
      userId,
      statusCode,
      error: error?.message || error,
    })
  }
}
