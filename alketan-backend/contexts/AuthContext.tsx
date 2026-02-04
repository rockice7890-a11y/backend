'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { UserRole, AdminLevel } from '@prisma/client'

interface User {
  userId: string
  role: UserRole
  adminLevel?: AdminLevel | null
  email?: string
  firstName?: string
  lastName?: string
}

interface AuthContextType {
  user: User | null
  login: (userData: User) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // تأخير قصير للسماح للـ cookies بالإنشاء
    const timer = setTimeout(() => {
      validateAuth()
    }, 50)
    
    return () => clearTimeout(timer)
  }, [])

  const validateAuth = async () => {
    try {
      // أولاً: محاولة استخدام بيانات المستخدم المخبأة مؤقتاً
      // هذا يسمح بعرض الصفحة حتى لو فشل /api/auth/me مؤقتاً
      const cachedUser = localStorage.getItem('cachedUser')
      if (cachedUser) {
        try {
          const parsedUser = JSON.parse(cachedUser)
          // تحويل بيانات المستخدم المخبأة إلى صيغة AuthContext
          setUser({
            userId: parsedUser.id,
            role: parsedUser.role as UserRole,
            adminLevel: parsedUser.adminLevel as AdminLevel | null,
            email: parsedUser.email,
            firstName: parsedUser.firstName,
            lastName: parsedUser.lastName,
          })
        } catch (e) {
          localStorage.removeItem('cachedUser')
        }
      }

      // ثانياً: التحقق من الجلسة عبر API
      // استخدام Session Cookie بدلاً من Access Token
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
      })

      if (response.ok) {
        const userData = await response.json()
        
        // تحديث بيانات المستخدم من الـ API
        setUser({
          userId: userData.user.id,
          role: userData.user.role as UserRole,
          adminLevel: userData.user.adminLevel as AdminLevel | null,
          email: userData.user.email,
          firstName: userData.user.firstName,
          lastName: userData.user.lastName,
        })
        
        // تحديث بيانات المستخدم المخبأة
        localStorage.setItem('cachedUser', JSON.stringify(userData.user))
      } else {
        // إذا فشل الـ API لكن هناك بيانات مخبأة، نستمر في عرضها
        // قد تكون الجلسة منتهية لكن المستخدم لا يزال قادراً على استخدام التطبيق
        // until the session expires
        if (!cachedUser) {
          setUser(null)
        }
      }
    } catch (error) {
      console.error('Auth validation error:', error)
      // لا نقوم بمسح المستخدم على error network
      // قد يكون خطأ مؤقت وسيتم حله في المرة القادمة
    } finally {
      setIsLoading(false)
    }
  }

  const login = (userData: User) => {
    // لا نخزن التوكن في localStorage - هو موجود في HttpOnly Cookie
    // لكننا نخزن بيانات المستخدم الأساسية للاستخدام المحلي
    setUser(userData)
  }

  const logout = () => {
    setUser(null)
    // حذف البيانات المخبأة
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('cachedUser')
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Permission hooks
export function usePermission(permission: string): boolean {
  const { user } = useAuth()
  if (!user) return false

  // This is a simplified version - in a real app, you'd call an API
  // or use the permission checking logic from the backend
  return true // Placeholder - implement based on your permission system
}

export function useRole(): UserRole | null {
  const { user } = useAuth()
  return user?.role || null
}

export function useAdminLevel(): AdminLevel | null {
  const { user } = useAuth()
  return user?.adminLevel || null
}
