
import { PrismaClient, UserRole, AdminLevel } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

interface SeedUser {
  email: string
  password: string
  firstName: string
  lastName: string
  name: string
  phone: string
  role: UserRole
  adminLevel: AdminLevel | null
  isActive: boolean
}

async function main() {
  console.log('بدء إنشاء البيانات الوهمية...')

  // إنشاء مستخدمين وهميين لأغراض الاختبار
  const users: SeedUser[] = [
    {
      email: 'admin@alketan.com',
      password: await bcrypt.hash('admin123', 10),
      firstName: 'أحمد',
      lastName: 'المدير',
      name: 'أحمد المدير',
      phone: '+966500000001',
      role: 'ADMIN',
      adminLevel: 'SUPER_ADMIN',
      isActive: true,
    },
    {
      email: 'manager@alketan.com',
      password: await bcrypt.hash('manager123', 10),
      firstName: 'محمد',
      lastName: 'مدير الفندق',
      name: 'محمد مدير الفندق',
      phone: '+966500000002',
      role: 'HOTEL_MANAGER',
      adminLevel: 'HOTEL_ADMIN',
      isActive: true,
    },
    {
      email: 'reception@alketan.com',
      password: await bcrypt.hash('reception123', 10),
      firstName: 'فاطمة',
      lastName: 'الموظفة',
      name: 'فاطمة الموظفة',
      phone: '+966500000003',
      role: 'RECEPTIONIST',
      adminLevel: null,
      isActive: true,
    },
    {
      email: 'user@alketan.com',
      password: await bcrypt.hash('user123', 10),
      firstName: 'عبدالله',
      lastName: 'العميل',
      name: 'عبدالله العميل',
      phone: '+966500000004',
      role: 'USER',
      adminLevel: null,
      isActive: true,
    },
    {
      email: 'guest@alketan.com',
      password: await bcrypt.hash('guest123', 10),
      firstName: 'نورة',
      lastName: 'الضيفة',
      name: 'نورة الضيفة',
      phone: '+966500000005',
      role: 'GUEST',
      adminLevel: null,
      isActive: true,
    }
  ]

  // إضافة المستخدمين إلى قاعدة البيانات
  for (const userData of users) {
    try {
      const user = await prisma.user.upsert({
        where: { email: userData.email },
        update: userData,
        create: userData,
      })
      console.log(`تم إنشاء المستخدم: ${user.name} (${user.email})`)
    } catch (error) {
      console.error(`خطأ في إنشاء المستخدم ${userData.email}:`, error)
    }
  }

  console.log('اكتمل إنشاء البيانات الوهمية بنجاح!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
