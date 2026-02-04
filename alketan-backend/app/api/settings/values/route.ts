import { withErrorHandler } from "@/utils/errorHandler";
import { NextRequest, NextResponse } from "next/server";
import { settingsService, UpdateSettingValueInput } from "@/lib/settings";
import { SettingScope } from "@prisma/client";
import { authenticate, AuthRequest } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";

// GET /api/settings/values
// الحصول على قيم الإعدادات
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const key = searchParams.get("key");
  const scope = searchParams.get("scope") as SettingScope | null;
  const scopeId = searchParams.get("scopeId") || undefined;

  if (!key) {
    return NextResponse.json(
      {
        success: false,
        error: "مفتاح الإعداد مطلوب",
      },
      { status: 400 }
    );
  }

  // الحصول على جميع قيم إعداد معين
  if (scope) {
    const result = await settingsService.getSettingValue(key, scope, scopeId);

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error: `الإعداد '${key}' غير موجود`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        key: result.definition.key,
        value: result.value,
        type: result.definition.type,
        scope: scope,
        scopeId: scopeId || null,
      },
    });
  }

  // الحصول على جميع قيم إعداد معين
  const values = await settingsService.getSettingValues(key);

  return NextResponse.json({
    success: true,
    data: values,
    total: values.length,
  });
});

// PUT /api/settings/values
// تحديث أو إنشاء قيمة إعداد
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authRequest = request as AuthRequest;
  const user = await authenticate(authRequest);

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "يجب تسجيل الدخول لتحديث الإعدادات",
      },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { key, value, scope, scopeId } = body as UpdateSettingValueInput & { key: string };

  // التحقق من الحقول الإلزامية
  if (!key || value === undefined || !scope) {
    return NextResponse.json(
      {
        success: false,
        error: "الحقول key و value و scope مطلوبة",
      },
      { status: 400 }
    );
  }

  // التحقق من صحة النطاق
  if (!Object.values(SettingScope).includes(scope)) {
    return NextResponse.json(
      {
        success: false,
        error: "النطاق غير صالح",
      },
      { status: 400 }
    );
  }

  // إذا كان النطاق فhotelId أو userId، يجب تحديده
  if ((scope === SettingScope.HOTEL || scope === SettingScope.USER) && !scopeId) {
    return NextResponse.json(
      {
        success: false,
        error: `معرف ${scope === SettingScope.HOTEL ? "الفندق" : "المستخدم"} مطلوب`,
      },
      { status: 400 }
    );
  }

  // التحقق من وجود الإعداد
  const setting = await settingsService.getSettingByKey(key);
  if (!setting) {
    return NextResponse.json(
      {
        success: false,
        error: `الإعداد '${key}' غير موجود`,
      },
      { status: 404 }
    );
  }

  // تحويل القيمة للنص للتخزين
  const stringValue = settingsService.stringifyValue(value, setting.type);

  // تحديث القيمة
  const result = await settingsService.setSettingValue(
    key,
    stringValue,
    scope,
    scopeId,
    user.userId
  );

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "UPDATE",
      resource: "SETTING",
      resourceId: key,
      details: JSON.stringify({
        scope,
        scopeId,
        value: setting.isSecret ? "[مخفي]" : value,
      }),
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      key: result.definition.key,
      value: value,
      scope: result.scope,
      scopeId: result.scopeId,
    },
    message: `تم تحديث إعداد '${key}' بنجاح`,
  });
});

// DELETE /api/settings/values
// حذف قيمة إعداد معينة
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authRequest = request as AuthRequest;
  const user = await authenticate(authRequest);

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "يجب تسجيل الدخول لحذف الإعدادات",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const scope = searchParams.get("scope") as SettingScope | null;
  const scopeId = searchParams.get("scopeId") || undefined;

  if (!key || !scope) {
    return NextResponse.json(
      {
        success: false,
        error: "مفتاح الإعداد والنطاق مطلوبان",
      },
      { status: 400 }
    );
  }

  // التحقق من وجود الإعداد
  const setting = await settingsService.getSettingByKey(key);
  if (!setting) {
    return NextResponse.json(
      {
        success: false,
        error: `الإعداد '${key}' غير موجود`,
      },
      { status: 404 }
    );
  }

  // حذف القيمة
  const deleted = await settingsService.deleteSettingValue(key, scope, scopeId);

  if (!deleted) {
    return NextResponse.json(
      {
        success: false,
        error: "قيمة الإعداد غير موجودة",
      },
      { status: 404 }
    );
  }

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "DELETE",
      resource: "SETTING",
      resourceId: key,
      details: JSON.stringify({
        scope,
        scopeId,
      }),
    },
  });

  return NextResponse.json({
    success: true,
    message: `تم حذف قيمة إعداد '${key}' بنجاح`,
  });
});
