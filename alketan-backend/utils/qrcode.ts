import QRCode from 'qrcode'
import crypto from 'crypto'

// إنشاء رمز فريد للحجز
export function generateBookingCode(bookingId: string): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(8).toString('hex')
  return `BOOK-${bookingId.substring(0, 8)}-${timestamp}-${random}`.toUpperCase()
}

// إنشاء QR code كصورة Base64
export async function generateQRCodeImage(data: string): Promise<string> {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 2,
    })
    return qrCodeDataURL
  } catch (error) {
    throw new Error('فشل في إنشاء QR code')
  }
}

// إنشاء QR code كـ Buffer
export async function generateQRCodeBuffer(data: string): Promise<Buffer> {
  try {
    const qrCodeBuffer = await QRCode.toBuffer(data, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 300,
      margin: 2,
    })
    return qrCodeBuffer
  } catch (error) {
    throw new Error('فشل في إنشاء QR code')
  }
}

// التحقق من صحة رمز الحجز
export function validateBookingCode(code: string): boolean {
  const pattern = /^BOOK-[A-Z0-9]{8}-\d+-[A-Z0-9]{16}$/
  return pattern.test(code)
}

