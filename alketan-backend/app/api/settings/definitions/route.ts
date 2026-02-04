import { withErrorHandler } from "@/utils/errorHandler";
import { NextRequest, NextResponse } from "next/server";
import { settingsService, CreateSettingInput } from "@/lib/settings";
import { SettingCategory, SettingType, SettingScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// GET /api/settings/definitions
// الحصول على تعريفات الإعدادات
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const key = searchParams.get("key") || undefined;
  const category = searchParams.get("category") as SettingCategory | null;
  const scope = searchParams.get("scope") as SettingScope | null;
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search") || undefined;

  const settings = await settingsService.getSettings({
    key,
    category: category || undefined,
    scope: scope || undefined,
    isActive: isActive !== null ? isActive === "true" : undefined,
    search: search || undefined,
  });

  return NextResponse.json({
    success: true,
    data: settings,
    total: settings.length,
  });
});

// POST /api/settings/definitions
// إنشاء إعداد جديد
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();

  const {
    key,
    name,
    nameAr,
    description,
    category,
    type,
    scope,
    value,
    isSecret,
    isEditable,
    sortOrder,
  } = body as CreateSettingInput;

  // التحقق من الحقول الإلزامية
  if (!key || !name || !category || !type) {
    return NextResponse.json(
      {
        success: false,
        error: "الحقول key و name و category و type مطلوبة",
      },
      { status: 400 }
    );
  }

  // التحقق من نوع الإعداد
  if (!Object.values(SettingType).includes(type)) {
    return NextResponse.json(
      {
        success: false,
        error: "نوع الإعداد غير صالح",
      },
      { status: 400 }
    );
  }

  // التحقق من فئة الإعداد
  if (category && !Object.values(SettingCategory).includes(category)) {
    return NextResponse.json(
      {
        success: false,
        error: "فئة الإعداد غير صالحة",
      },
      { status: 400 }
    );
  }

  // التحقق من صيغة المفتاح (يجب أن يكون snake_case)
  const keyRegex = /^[a-z][a-z0-9_]*$/;
  if (!keyRegex.test(key)) {
    return NextResponse.json(
      {
        success: false,
        error: "صيغة المفتاح غير صالحة. يجب أن يبدأ بحرف صغير ويحتوي على أحرف صغيرة وأرقام وشرطات سفلية فقط",
      },
      { status: 400 }
    );
  }

  // إنشاء الإعداد
  const setting = await settingsService.createSetting({
    key,
    name,
    nameAr,
    description,
    category,
    type,
    scope: scope || SettingScope.GLOBAL,
    value: value ? settingsService.stringifyValue(value, type) : undefined,
    isSecret: isSecret || false,
    isEditable: isEditable !== false,
    sortOrder: sortOrder || 0,
  });

  return NextResponse.json({
    success: true,
    data: setting,
    message: `تم إنشاء الإعداد '${key}' بنجاح`,
  });
});
