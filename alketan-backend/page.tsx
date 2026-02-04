'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'

export default function Home() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) {
      router.push('/dashboard')
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (user) {
    return null // Will redirect to dashboard
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl font-bold text-gray-900">🏨 متان</span>
              </div>
              <div className="mr-4">
                <h1 className="text-xl font-semibold text-gray-900">نظام إدارة الفنادق</h1>
                <p className="text-sm text-gray-500">نظام متكامل لإدارة الفنادق والحجوزات</p>
              </div>
            </div>
            <Link
              href="/login"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
            نظام إدارة الفنادق
            <span className="block text-blue-600">المتطور</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            نظام متكامل لإدارة الفنادق والحجوزات مع نظام صلاحيات متقدم يضمن الأمان والكفاءة في إدارة أعمال الضيافة
          </p>

          <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
            <div className="rounded-md shadow">
              <Link
                href="/login"
                className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10 transition-colors"
              >
                البدء في الاستخدام
              </Link>
            </div>
            <div className="mt-3 rounded-md shadow sm:mt-0 sm:mr-3">
              <a
                href="#features"
                className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-blue-600 bg-white hover:bg-gray-50 md:py-4 md:text-lg md:px-10 transition-colors"
              >
                المزيد من المعلومات
              </a>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className="mt-24">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">
              مميزات النظام
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-500">
              نظام شامل يلبي جميع احتياجات إدارة الفنادق
            </p>
          </div>

          <div className="mt-16">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {/* Feature 1 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">🔐</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">نظام صلاحيات متقدم</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        تحكم دقيق في الصلاحيات مع دعم الأدوار المختلفة والمستويات الإدارية
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">🏨</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">إدارة شاملة للفنادق</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        إدارة كاملة للفنادق والغرف والخدمات مع إمكانيات البحث والفلترة المتقدمة
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">📅</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">نظام الحجوزات الذكي</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        نظام حجوزات متقدم مع إدارة الخدمات الإضافية وتتبع حالة الحجوزات
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">👥</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">إدارة المستخدمين</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        إدارة شاملة للمستخدمين مع إمكانية تعديل الأدوار والصلاحيات
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 5 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">💰</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">التقارير المالية</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        تقارير مالية مفصلة وإحصائيات شاملة لمتابعة أداء الأعمال
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 6 */}
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <span className="text-3xl">🧪</span>
                    </div>
                    <div className="mr-4">
                      <h3 className="text-lg font-medium text-gray-900">أدوات الاختبار</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        أدوات متقدمة لاختبار وتجربة نظام الصلاحيات والتأكد من سلامة النظام
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-24 bg-blue-600 rounded-lg">
          <div className="max-w-2xl mx-auto text-center py-16 px-4 sm:py-20 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
              <span className="block">ابدأ في استخدام النظام الآن</span>
            </h2>
            <p className="mt-4 text-lg leading-6 text-blue-200">
              انضم إلى آلاف الفنادق التي تستخدم نظام متان لإدارة أعمالها بكفاءة واحترافية
            </p>
            <Link
              href="/login"
              className="mt-8 w-full inline-flex items-center justify-center px-5 py-3 border border-transparent text-base font-medium rounded-md text-blue-600 bg-white hover:bg-blue-50 sm:w-auto transition-colors"
          >
              تسجيل الدخول للبدء
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8">
          <div className="text-center">
            <span className="text-2xl font-bold text-gray-900">🏨 متان</span>
            <p className="mt-2 text-sm text-gray-500">
              © 2024 نظام إدارة الفنادق. جميع الحقوق محفوظة.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
