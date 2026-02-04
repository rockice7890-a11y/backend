import { withErrorHandler } from "@/utils/errorHandler";
import { NextRequest, NextResponse } from "next/server";
import { settingsService, SettingsFilter } from "@/lib/settings";
import { SettingCategory, SettingScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// GET /api/settings
// الحصول على الإعدادات مع إمكانية التصفية والترتيب
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const key = searchParams.get("key") || undefined;
  const category = searchParams.get("category") as SettingCategory | null;
  const scope = searchParams.get("scope") as SettingScope | null;
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search") || undefined;

  // تصفية حسب الفئة
  const categoryFilter = category || undefined;

  // تصفية حسب النطاق
  const scopeFilter = scope || undefined;

  // تصفية حسب النشاط
  const isActiveFilter = isActive !== null ? isActive === "true" : undefined;

  const settings = await settingsService.getSettings({
    key,
    category: categoryFilter,
    scope: scopeFilter,
    isActive: isActiveFilter,
    search,
  });

  return NextResponse.json({
    success: true,
    data: settings,
    total: settings.length,
  });
});
