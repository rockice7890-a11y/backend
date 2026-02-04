'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { User, UserRole, AdminLevel } from '@prisma/client'

interface UserWithoutPassword {
  id: string
  email: string
  firstName: string
  lastName: string
  name: string
  phone: string | null
  avatar: string | null
  bio: string | null
  role: UserRole
  adminLevel: AdminLevel | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  hotelId: string | null
  failedLoginAttempts: number
  lockoutUntil: Date | null
  lastFailedLogin: Date | null
  lastLoginAt: Date | null
  twoFactorEnabled: boolean
}

interface AuthContextType {
  user: UserWithoutPassword | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; message: string; requiresTwoFactor?: boolean; user?: UserWithoutPassword }>
  register: (data: RegisterData) => Promise<{ success: boolean; message: string }>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  checkPermission: (permission: string) => boolean
  hasRole: (roles: UserRole[]) => boolean
}

interface RegisterData {
  email: string
  password: string
  firstName: string
  lastName: string
  phone?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserWithoutPassword | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me')
      if (response.ok) {
        const data = await response.json()
        setUser(data.data)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('Error fetching user:', error)
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        if (data.requiresTwoFactor) {
          return { success: true, message: data.message, requiresTwoFactor: true, user: data.user }
        }
        await refreshUser()
        router.push('/dashboard')
        router.refresh()
        return { success: true, message: data.message }
      }

      return { success: false, message: data.message || 'فشل تسجيل الدخول' }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, message: 'حدث خطأ أثناء تسجيل الدخول' }
    }
  }

  const register = async (data: RegisterData) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      const result = await response.json()

      if (response.ok && result.success) {
        return { success: true, message: result.message }
      }

      return { success: false, message: result.message || 'فشل التسجيل' }
    } catch (error) {
      console.error('Register error:', error)
      return { success: false, message: 'حدث خطأ أثناء التسجيل' }
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setUser(null)
      router.push('/auth/login')
      router.refresh()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const checkPermission = useCallback((permission: string): boolean => {
    if (!user) return false
    if (user.role === UserRole.ADMIN || user.adminLevel === AdminLevel.SUPER_ADMIN) return true
    return false
  }, [user])

  const hasRole = useCallback((roles: UserRole[]): boolean => {
    if (!user) return false
    return roles.includes(user.role)
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      refreshUser,
      checkPermission,
      hasRole
    }}>
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

export type { UserWithoutPassword }
