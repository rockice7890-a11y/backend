import { withErrorHandler } from "@/utils/errorHandler";
import { NextRequest, NextResponse } from "next/server";
import { settingsService } from "@/lib/settings";
import { SettingCategory, SettingType, SettingScope } from "@prisma/client";
import { authenticate, AuthRequest } from "@/middleware/auth";
import { prisma } from "@/lib/prisma";

// GET /api/settings/[key]
// الحصول على إعداد معين بجميع قيمه
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: { key: string } }) => {
  const { key } = params;

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

  const values = await settingsService.getSettingValues(key);

  return NextResponse.json({
    success: true,
    data: {
      ...setting,
      values,
    },
  });
});

// PUT /api/settings/[key]
// تحديث تعريف إعداد
export const PUT = withErrorHandler(async (request: NextRequest, { params }: { params: { key: string } }) => {
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

  const { key } = params;
  const body = await request.json();

  const existing = await settingsService.getSettingByKey(key);
  if (!existing) {
    return NextResponse.json(
      {
        success: false,
        error: `الإعداد '${key}' غير موجود`,
      },
      { status: 404 }
    );
  }

  // الحقول المسموح بتحديثها
  const allowedUpdates = ["name", "nameAr", "description", "sortOrder", "isActive"];
  const updates: any = {};

  for (const field of allowedUpdates) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  // تحديث القيمة الافتراضية إذا تم تقديمها
  if (body.value !== undefined && existing.type) {
    // التحقق من صحة القيمة
    try {
      if (existing.type === SettingType.BOOLEAN) {
        if (body.value !== "true" && body.value !== "false") {
          throw new Error("قيمة خاطئة لـ Boolean");
        }
      } else if (existing.type === SettingType.NUMBER && isNaN(Number(body.value))) {
        throw new Error("قيمة خاطئة لـ Number");
      } else if ((existing.type === SettingType.ARRAY || existing.type === SettingType.JSON) && typeof body.value === "string") {
        JSON.parse(body.value);
      }
      updates.value = String(body.value);
    } catch (e: any) {
      return NextResponse.json(
        {
          success: false,
          error: `خطأ في القيمة: ${e.message}`,
        },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.systemSetting.update({
    where: { key },
    data: updates,
  });

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "UPDATE",
      resource: "SETTING_DEFINITION",
      resourceId: key,
      details: JSON.stringify({
        updates: Object.keys(updates),
      }),
    },
  });

  return NextResponse.json({
    success: true,
    data: updated,
    message: `تم تحديث إعداد '${key}' بنجاح`,
  });
});

// DELETE /api/settings/[key]
// حذف إعداد بالكامل
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: { key: string } }) => {
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

  const { key } = params;

  const existing = await settingsService.getSettingByKey(key);
  if (!existing) {
    return NextResponse.json(
      {
        success: false,
        error: `الإعداد '${key}' غير موجود`,
      },
      { status: 404 }
    );
  }

  await settingsService.deleteSetting(key);

  // تسجيل في سجل التدقيق
  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "DELETE",
      resource: "SETTING_DEFINITION",
      resourceId: key,
      details: JSON.stringify({
        settingName: existing.name,
        category: existing.category,
      }),
    },
  });

  return NextResponse.json({
    success: true,
    message: `تم حذف إعداد '${key}' بنجاح`,
  });
});
