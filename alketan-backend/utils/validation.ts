import { z } from 'zod'

// مخططات التحقق من صحة البيانات

export const registerSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  firstName: z.string().min(2, 'الاسم الأول يجب أن يكون حرفين على الأقل'),
  lastName: z.string().min(2, 'الاسم الأخير يجب أن يكون حرفين على الأقل'),
  name: z.string().optional(), // للحفاظ على التوافق
  phone: z.string().optional(),
  role: z.enum(['GUEST', 'USER', 'HOTEL_MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'ADMIN']).optional(),
  adminLevel: z.enum(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'HOTEL_ADMIN', 'DEPARTMENT_HEAD', 'SUPERVISOR']).optional(),
})

export const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
})

export const hotelSchema = z.object({
  name: z.string().min(2, 'اسم الفندق مطلوب'),
  nameAr: z.string().optional(),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  address: z.string().min(5, 'العنوان مطلوب'),
  city: z.string().min(2, 'المدينة مطلوبة'),
  country: z.string().min(2, 'الدولة مطلوبة'),
  phone: z.string().min(8, 'رقم الهاتف مطلوب'),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  rating: z.number().min(0).max(5).optional(),
})

export const roomSchema = z.object({
  number: z.string().min(1, 'رقم الغرفة مطلوب'),
  type: z.enum(['SINGLE', 'DOUBLE', 'SUITE', 'DELUXE', 'FAMILY', 'PRESIDENTIAL']),
  floor: z.number().int().positive().optional(),
  capacity: z.number().int().positive().default(1),
  price: z.number().positive('السعر يجب أن يكون موجب'),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  amenities: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
})

export const bookingSchema = z.object({
  hotelId: z.string().min(1, 'معرف الفندق مطلوب'),
  roomId: z.string().min(1, 'معرف الغرفة مطلوب'),
  checkIn: z.string().datetime('تاريخ الدخول غير صحيح'),
  checkOut: z.string().datetime('تاريخ الخروج غير صحيح'),
  guests: z.number().int().positive().default(1),
  specialRequests: z.string().optional(),
  paymentMethod: z.string().optional(),
}).refine((data) => {
  const checkIn = new Date(data.checkIn)
  const checkOut = new Date(data.checkOut)
  return checkOut > checkIn
}, {
  message: 'تاريخ الخروج يجب أن يكون بعد تاريخ الدخول',
  path: ['checkOut'],
})

export const featureSchema = z.object({
  name: z.string().min(2, 'اسم الميزة مطلوب'),
  nameAr: z.string().optional(),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  icon: z.string().optional(),
  category: z.enum(['AMENITY', 'SERVICE', 'FACILITY', 'ENTERTAINMENT', 'DINING', 'BUSINESS', 'WELLNESS']),
})

export const updateUserSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  name: z.string().optional(), // للحفاظ على التوافق
  phone: z.string().optional(),
  avatar: z.string().optional(),
  bio: z.string().optional(),
  role: z.enum(['GUEST', 'USER', 'HOTEL_MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'ADMIN']).optional(),
  adminLevel: z.enum(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'HOTEL_ADMIN', 'DEPARTMENT_HEAD', 'SUPERVISOR']).optional(),
  isActive: z.boolean().optional(),
})

