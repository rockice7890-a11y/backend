import { settingsService } from "./settings";
import { SettingScope, SettingType } from "@prisma/client";

// دالة مبسطة للحصول على إعداد
export async function getSetting<T = string>(
  key: string,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<T | null> {
  const result = await settingsService.getSettingValue(key, scope, scopeId);

  if (!result) {
    return null;
  }

  return result.value as T;
}

// دالة للحصول على إعداد مع قيمة افتراضية
export async function getSettingWithDefault<T = string>(
  key: string,
  defaultValue: T,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<T> {
  const value = await getSetting<T>(key, scope, scopeId);

  if (value === null) {
    return defaultValue;
  }

  return value;
}

// دالة للتحقق من تفعيل إعداد معين
export async function isSettingEnabled(
  key: string,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<boolean> {
  const value = await getSetting<boolean>(key, scope, scopeId);
  return value === true;
}

// دالة للحصول على إعداد كرقم
export async function getSettingAsNumber(
  key: string,
  defaultValue: number = 0,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<number> {
  const value = await getSetting<number>(key, scope, scopeId);

  if (typeof value !== "number" || isNaN(value)) {
    return defaultValue;
  }

  return value;
}

// دالة للحصول على إعداد كنص
export async function getSettingAsString(
  key: string,
  defaultValue: string = "",
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<string> {
  const value = await getSetting<string>(key, scope, scopeId);

  if (typeof value !== "string") {
    return defaultValue;
  }

  return value || defaultValue;
}

// دالة للحصول على إعداد كمصفوفة
export async function getSettingAsArray<T = any>(
  key: string,
  defaultValue: T[] = [],
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<T[]> {
  const value = await getSetting<T[]>(key, scope, scopeId);

  if (!Array.isArray(value)) {
    return defaultValue;
  }

  return value;
}

// دالة للحصول على إعداد كـ JSON
export async function getSettingAsJSON<T = any>(
  key: string,
  defaultValue: T,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<T> {
  const value = await getSetting<T>(key, scope, scopeId);

  if (value === null || value === undefined) {
    return defaultValue;
  }

  return value;
}

// دالة للحصول على جميع إعدادات نطاق معين
export async function getAllSettingsForScope(
  scope: SettingScope,
  scopeId?: string
): Promise<Record<string, any>> {
  const settings = await settingsService.getSettingsForScope(scope, scopeId);

  const result: Record<string, any> = {};

  for (const { definition, value } of settings) {
    result[definition.key] = value;
  }

  return result;
}

// دالة للحصول على إعدادات فئة معينة
export async function getSettingsByCategory(
  category: string,
  scope: SettingScope = SettingScope.GLOBAL,
  scopeId?: string
): Promise<Record<string, any>> {
  const settings = await settingsService.getSettingsByCategory(
    category as any
  );

  const result: Record<string, any> = {};

  for (const definition of settings) {
    const value = await settingsService.getSettingValue(
      definition.key,
      scope,
      scopeId
    );

    result[definition.key] = value?.value ?? definition.value ?? null;
  }

  return result;
}

// دالة للتحقق من وضع الصيانة
export async function isMaintenanceMode(): Promise<boolean> {
  return isSettingEnabled("maintenance_mode");
}

// دالة للتحقق من وضع الإغلاق
export async function isLockdownMode(): Promise<boolean> {
  return isSettingEnabled("lockdown_mode");
}

// دالة للحصول على اسم الموقع
export async function getSiteName(): Promise<string> {
  return getSettingAsString("site_name", "Alketan");
}

// دالة للحصول على العملة الافتراضية
export async function getDefaultCurrency(): Promise<string> {
  return getSettingAsString("default_currency", "USD");
}

// دالة للحصول على الحد الأقصى لعدد ليالي الحجز
export async function getMaxBookingNights(): Promise<number> {
  return getSettingAsNumber("booking_max_nights", 30);
}

// دالة للحصول على الحد الأدنى لعدد ليالي الحجز
export async function getMinBookingNights(): Promise<number> {
  return getSettingAsNumber("booking_min_nights", 1);
}

// دالة للتحقق من تفعيل إشعارات البريد
export async function areEmailNotificationsEnabled(): Promise<boolean> {
  return isSettingEnabled("email_notifications_enabled");
}

// دالة للتحقق من تفعيل إشعارات الرسائل القصيرة
export async function areSMSNotificationsEnabled(): Promise<boolean> {
  return isSettingEnabled("sms_notifications_enabled");
}

// ==================== إعدادات أوقات العمل ====================

// دالة للحصول على وقت تسجيل الوصول الافتراضي
export async function getDefaultCheckinTime(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<string> {
  return getSettingAsString("default_checkin_time", "15:00", scope, scopeId);
}

// دالة للحصول على وقت تسجيل المغادرة الافتراضي
export async function getDefaultCheckoutTime(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<string> {
  return getSettingAsString("default_checkout_time", "11:00", scope, scopeId);
}

// دالة للتحقق من عمل الاستقبال على مدار الساعة
export async function isReception24_7(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<boolean> {
  return isSettingEnabled("reception_24_7", scope, scopeId);
}

// دالة للحصول على ساعات عمل الاستقبال
export async function getReceptionWorkingHours(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<{ start: string; end: string; is24_7: boolean }> {
  const [start, end, is24_7] = await Promise.all([
    getSettingAsString("reception_working_hours_start", "00:00", scope, scopeId),
    getSettingAsString("reception_working_hours_end", "23:59", scope, scopeId),
    isReception24_7(scope, scopeId),
  ]);

  return { start, end, is24_7 };
}

// ==================== إعدادات القفل المجدول ====================

// دالة للتحقق من تفعيل القفل المجدول
export async function isScheduledLockEnabled(): Promise<boolean> {
  return isSettingEnabled("scheduled_lock_enabled");
}

// دالة للحصول على وقت بدء القفل
export async function getScheduledLockStartTime(): Promise<string> {
  return getSettingAsString("scheduled_lock_start_time", "22:00");
}

// دالة للحصول على وقت انتهاء القفل
export async function getScheduledLockEndTime(): Promise<string> {
  return getSettingAsString("scheduled_lock_end_time", "06:00");
}

// دالة للحصول على أيام القفل
export async function getScheduledLockDays(): Promise<number[]> {
  return getSettingAsArray<number>("scheduled_lock_days", [0, 1, 2, 3, 4, 5, 6]);
}

// دالة للحصول على رسالة القفل
export async function getLockMessage(locale: string = "ar"): Promise<string> {
  const key = locale === "ar" ? "lock_message_ar" : "lock_message";
  const defaultMessage = locale === "ar" 
    ? "التطبيق مغلق حالياً. يرجى المحاولة لاحقاً."
    : "The application is currently locked. Please try again later.";
  
  return getSettingAsString(key, defaultMessage);
}

// دالة للتحقق مما إذا كان التطبيق مقفلاً حالياً
export async function isAppLocked(): Promise<{ locked: boolean; message?: string }> {
  // التحقق من وضع الصيانة أولاً
  if (await isMaintenanceMode()) {
    return { locked: true };
  }

  // التحقق من وضع الإغلاق
  if (await isLockdownMode()) {
    return { locked: true };
  }

  // التحقق من القفل المجدول
  const scheduledLockEnabled = await isScheduledLockEnabled();
  if (!scheduledLockEnabled) {
    return { locked: false };
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.toTimeString().slice(0, 5); // HH:mm

  const lockDays = await getScheduledLockDays();
  if (!lockDays.includes(currentDay)) {
    return { locked: false };
  }

  const startTime = await getScheduledLockStartTime();
  const endTime = await getScheduledLockEndTime();

  // التحقق من الوقت
  if (startTime <= endTime) {
    // القفل في نفس اليوم (مثال: 10:00 إلى 18:00)
    if (currentTime >= startTime && currentTime < endTime) {
      const message = await getLockMessage();
      return { locked: true, message };
    }
  } else {
    // القفل يمر عبر منتصف الليل (مثال: 22:00 إلى 06:00)
    if (currentTime >= startTime || currentTime < endTime) {
      const message = await getLockMessage();
      return { locked: true, message };
    }
  }

  return { locked: false };
}

// ==================== إعدادات الشريط الإعلاني ====================

// دالة للتحقق من تفعيل الشريط الإعلاني
export async function isAnnouncementBannerEnabled(): Promise<boolean> {
  return isSettingEnabled("announcement_banner_enabled");
}

// دالة للحصول على نص الشريط الإعلاني
export async function getAnnouncementBannerText(locale: string = "ar"): Promise<string | null> {
  const key = locale === "ar" ? "announcement_banner_text_ar" : "announcement_banner_text";
  const value = await getSetting<string>(key);
  return value || null;
}

// دالة للحصول على لون الشريط الإعلاني
export async function getAnnouncementBannerColor(): Promise<string> {
  return getSettingAsString("announcement_banner_color", "#FF6B6B");
}

// دالة للحصول على لون نص الشريط الإعلاني
export async function getAnnouncementBannerTextColor(): Promise<string> {
  return getSettingAsString("announcement_banner_text_color", "#FFFFFF");
}

// دالة للحصول على رابط الشريط الإعلاني
export async function getAnnouncementBannerLink(): Promise<string | null> {
  const link = await getSetting<string>("announcement_banner_link");
  return link || null;
}

// دالة للحصول على معلومات الشريط الإعلاني الكاملة
export async function getAnnouncementBanner(locale: string = "ar") {
  const enabled = await isAnnouncementBannerEnabled();
  
  if (!enabled) {
    return null;
  }

  // التحقق من التواريخ
  const now = new Date();
  
  const startDateStr = await getSetting<string>("announcement_banner_start_date");
  if (startDateStr && new Date(startDateStr) > now) {
    return null;
  }

  const endDateStr = await getSetting<string>("announcement_banner_end_date");
  if (endDateStr && new Date(endDateStr) < now) {
    return null;
  }

  const text = locale === "ar" 
    ? await getSetting<string>("announcement_banner_text_ar")
    : await getSetting<string>("announcement_banner_text");

  if (!text) {
    return null;
  }

  return {
    text,
    backgroundColor: await getAnnouncementBannerColor(),
    textColor: await getAnnouncementBannerTextColor(),
    link: await getAnnouncementBannerLink(),
  };
}

// ==================== إعدادات المظهر والثيم ====================

// دالة للحصول على الثيم الافتراضي
export async function getDefaultTheme(
  scope: SettingScope = SettingScope.USER,
  scopeId?: string
): Promise<"light" | "dark" | "system"> {
  const theme = await getSettingAsString("default_theme", "system", scope, scopeId);
  return (theme as "light" | "dark" | "system") || "system";
}

// دالة للتحقق من تفعيل الوضع الداكن
export async function isDarkModeEnabled(): Promise<boolean> {
  return isSettingEnabled("enable_dark_mode");
}

// دالة للحصول على اللون الأساسي
export async function getPrimaryColor(): Promise<string> {
  return getSettingAsString("primary_color", "#3B82F6");
}

// دالة للحصول على اللون الثانوي
export async function getSecondaryColor(): Promise<string> {
  return getSettingAsString("secondary_color", "#10B981");
}

// ==================== إعدادات اللغة ====================

// دالة للحصول على اللغات المدعومة
export async function getSupportedLanguages(): Promise<string[]> {
  return getSettingAsArray<string>("supported_languages", ["ar", "en"]);
}

// دالة للتحقق من فرض اتجاه RTL
export async function isForceRTL(): Promise<boolean> {
  return isSettingEnabled("force_rtl");
}

// دالة للتحقق من إظهار منتقي اللغة
export async function shouldShowLanguageSelector(): Promise<boolean> {
  return isSettingEnabled("show_language_selector");
}

// ==================== إعدادات الحجز الإضافية ====================

// دالة للتحقق من السماح بالحجز في نفس اليوم
export async function isSameDayBookingAllowed(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<boolean> {
  return isSettingEnabled("allow_same_day_booking", scope, scopeId);
}

// دالة للتحقق من طلب دفعة مقدمة
export async function isDepositRequired(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<boolean> {
  return isSettingEnabled("require_deposit", scope, scopeId);
}

// دالة للحصول على نسبة الدفعة المقدمة
export async function getDepositPercentage(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<number> {
  return getSettingAsNumber("deposit_percentage", 20, scope, scopeId);
}

// دالة للتحقق من السماح بتعديل الحجز
export async function isBookingModificationAllowed(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<boolean> {
  return isSettingEnabled("allow_booking_modification", scope, scopeId);
}

// دالة للحصول على ساعات تعديل الحجز
export async function getBookingModificationHours(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<number> {
  return getSettingAsNumber("booking_modification_hours", 48, scope, scopeId);
}

// دالة للتحقق من إمكانية تعديل حجز معين
export async function canModifyBooking(
  bookingCheckin: Date,
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<boolean> {
  const allowed = await isBookingModificationAllowed(scope, scopeId);
  if (!allowed) {
    return false;
  }

  const modificationHours = await getBookingModificationHours(scope, scopeId);
  const hoursUntilCheckin = (bookingCheckin.getTime() - Date.now()) / (1000 * 60 * 60);

  return hoursUntilCheckin >= modificationHours;
}

// ==================== دوال مساعدة مركبة ====================

// دالة للحصول على معلومات الحجز الكاملة من الإعدادات
export interface BookingSettingsInfo {
  maxNights: number;
  minNights: number;
  maxGuests: number;
  checkinTime: string;
  checkoutTime: string;
  allowSameDayBooking: boolean;
  requireDeposit: boolean;
  depositPercentage: number;
  allowModification: boolean;
  modificationHours: number;
  currency: string;
}

export async function getBookingSettings(
  scope: SettingScope = SettingScope.HOTEL,
  scopeId?: string
): Promise<BookingSettingsInfo> {
  const [
    maxNights,
    minNights,
    maxGuests,
    checkinTime,
    checkoutTime,
    allowSameDayBooking,
    requireDeposit,
    depositPercentage,
    allowModification,
    modificationHours,
    currency,
  ] = await Promise.all([
    getSettingAsNumber("booking_max_nights", 30, scope, scopeId),
    getSettingAsNumber("booking_min_nights", 1, scope, scopeId),
    getSettingAsNumber("booking_max_guests", 10, scope, scopeId),
    getDefaultCheckinTime(scope, scopeId),
    getDefaultCheckoutTime(scope, scopeId),
    isSameDayBookingAllowed(scope, scopeId),
    isDepositRequired(scope, scopeId),
    getDepositPercentage(scope, scopeId),
    isBookingModificationAllowed(scope, scopeId),
    getBookingModificationHours(scope, scopeId),
    getSettingAsString("default_currency", "USD", scope, scopeId),
  ]);

  return {
    maxNights,
    minNights,
    maxGuests,
    checkinTime,
    checkoutTime,
    allowSameDayBooking,
    requireDeposit,
    depositPercentage,
    allowModification,
    modificationHours,
    currency,
  };
}

// دالة للحصول على معلومات القفل الكاملة
export interface LockInfo {
  maintenanceMode: boolean;
  lockdownMode: boolean;
  scheduledLockEnabled: boolean;
  scheduledLock: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    days: number[];
    currentStatus: "locked" | "unlocked" | "outside_schedule";
  };
  message?: string;
}

export async function getLockInfo(): Promise<LockInfo> {
  const [
    maintenanceMode,
    lockdownMode,
    scheduledLockEnabled,
    startTime,
    endTime,
    lockDays,
    currentStatus,
  ] = await Promise.all([
    isMaintenanceMode(),
    isLockdownMode(),
    isScheduledLockEnabled(),
    getScheduledLockStartTime(),
    getScheduledLockEndTime(),
    getScheduledLockDays(),
    isAppLocked(),
  ]);

  return {
    maintenanceMode,
    lockdownMode,
    scheduledLockEnabled,
    scheduledLock: {
      enabled: scheduledLockEnabled,
      startTime,
      endTime,
      days: lockDays,
      currentStatus: currentStatus.locked ? "locked" : "unlocked",
    },
    message: currentStatus.message,
  };
}

// دالة للحصول على معلومات الثيم الكاملة
export interface ThemeInfo {
  defaultTheme: "light" | "dark" | "system";
  darkModeEnabled: boolean;
  primaryColor: string;
  secondaryColor: string;
}

export async function getThemeInfo(): Promise<ThemeInfo> {
  const [defaultTheme, darkModeEnabled, primaryColor, secondaryColor] = await Promise.all([
    getDefaultTheme(),
    isDarkModeEnabled(),
    getPrimaryColor(),
    getSecondaryColor(),
  ]);

  return {
    defaultTheme,
    darkModeEnabled,
    primaryColor,
    secondaryColor,
  };
}
