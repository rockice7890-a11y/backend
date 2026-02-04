import { prisma } from "@/lib/prisma";
import { SettingType, SettingScope, SettingCategory } from "@prisma/client";

export interface SettingDefinition {
  id: string;
  key: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  category: SettingCategory;
  type: SettingType;
  scope: SettingScope;
  value?: string | null;
  isSecret: boolean;
  isEditable: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingValueWithDefinition {
  id: string;
  settingId: string;
  scope: SettingScope;
  scopeId?: string | null;
  value: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  definition: SettingDefinition;
}

export interface CreateSettingInput {
  key: string;
  name: string;
  nameAr?: string;
  description?: string;
  category: SettingCategory;
  type: SettingType;
  scope?: SettingScope;
  value?: string;
  isSecret?: boolean;
  isEditable?: boolean;
  sortOrder?: number;
}

export interface UpdateSettingValueInput {
  value: string;
  scope: SettingScope;
  scopeId?: string;
}

export interface SettingsFilter {
  category?: SettingCategory;
  scope?: SettingScope;
  key?: string;
  isActive?: boolean;
  search?: string;
}

class SettingsService {
  /**
   * إنشاء إعداد جديد
   */
  async createSetting(input: CreateSettingInput): Promise<SettingDefinition> {
    const existing = await prisma.systemSetting.findUnique({
      where: { key: input.key },
    });

    if (existing) {
      throw new Error(`الإعداد '${input.key}' موجود بالفعل`);
    }

    const setting = await prisma.systemSetting.create({
      data: {
        key: input.key,
        name: input.name,
        nameAr: input.nameAr,
        description: input.description,
        category: input.category,
        type: input.type,
        scope: input.scope || SettingScope.GLOBAL,
        value: input.value,
        isSecret: input.isSecret || false,
        isEditable: input.isEditable !== false,
        sortOrder: input.sortOrder || 0,
      },
    });

    return setting;
  }

  /**
   * الحصول على إعداد بالمفتاح
   */
  async getSettingByKey(key: string): Promise<SettingDefinition | null> {
    return prisma.systemSetting.findUnique({
      where: { key },
    });
  }

  /**
   * الحصول على إعداد بالمعرف
   */
  async getSettingById(id: string): Promise<SettingDefinition | null> {
    return prisma.systemSetting.findUnique({
      where: { id },
    });
  }

  /**
   * جلب جميع الإعدادات مع إمكانية التصفية
   */
  async getSettings(filter: SettingsFilter = {}): Promise<SettingDefinition[]> {
    const where: any = {};

    if (filter.category) {
      where.category = filter.category;
    }

    if (filter.scope) {
      where.scope = filter.scope;
    }

    if (filter.key) {
      where.key = filter.key;
    }

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.search) {
      where.OR = [
        { key: { contains: filter.search, mode: "insensitive" } },
        { name: { contains: filter.search, mode: "insensitive" } },
        { nameAr: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    return prisma.systemSetting.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    });
  }

  /**
   * الحصول على قيمة إعداد مع الأخذ بالاعتبار التسلسل الهرمي للنطاقات
   */
  async getSettingValue(
    key: string,
    scope: SettingScope = SettingScope.GLOBAL,
    scopeId?: string
  ): Promise<{ value: any; definition: SettingDefinition } | null> {
    const definition = await this.getSettingByKey(key);

    if (!definition) {
      return null;
    }

    // البحث عن قيمة في النطاق المحدد
    const specificValue = await prisma.settingValue.findFirst({
      where: {
        settingId: definition.id,
        scope: scope,
        scopeId: scopeId || null,
      },
    });

    // إذا وجدت قيمة في النطاق المحدد، استخدمها
    if (specificValue) {
      return {
        value: this.parseValue(specificValue.value, definition.type),
        definition,
      };
    }

    // إذا كان النطاق ليس عاماً، حاول إيجاد قيمة على المستوى العام
    if (scope !== SettingScope.GLOBAL) {
      const globalValue = await prisma.settingValue.findFirst({
        where: {
          settingId: definition.id,
          scope: SettingScope.GLOBAL,
          scopeId: null,
        },
      });

      if (globalValue) {
        return {
          value: this.parseValue(globalValue.value, definition.type),
          definition,
        };
      }
    }

    // استخدام القيمة الافتراضية
    if (definition.value != null) {
      return {
        value: this.parseValue(definition.value!, definition.type),
        definition,
      };
    }

    // إرجاع قيمة افتراضية بناءً على النوع
    return {
      value: this.getDefaultValue(definition.type),
      definition,
    };
  }

  /**
   * الحصول على جميع القيم لإعداد معين
   */
  async getSettingValues(
    key: string
  ): Promise<SettingValueWithDefinition[]> {
    const definition = await this.getSettingByKey(key);

    if (!definition) {
      return [];
    }

    const values = await prisma.settingValue.findMany({
      where: {
        settingId: definition.id,
      },
      include: {
        setting: true,
      },
      orderBy: [{ scope: "asc" }, { scopeId: "asc" }],
    });

    return values.map((v) => ({
      id: v.id,
      settingId: v.settingId,
      scope: v.scope,
      scopeId: v.scopeId,
      value: v.value,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      createdBy: v.createdBy,
      definition: v.setting as SettingDefinition,
    }));
  }

  /**
   * تحديث أو إنشاء قيمة إعداد
   */
  async setSettingValue(
    key: string,
    value: string,
    scope: SettingScope,
    scopeId?: string,
    userId?: string
  ): Promise<SettingValueWithDefinition> {
    const definition = await this.getSettingByKey(key);

    if (!definition) {
      throw new Error(`الإعداد '${key}' غير موجود`);
    }

    // التحقق من نوع القيمة
    this.validateValue(value, definition.type);

    const scopeIdValue = scopeId || null

    const settingValue = await prisma.settingValue.upsert({
      where: {
        settingId_scope_scopeId: {
          settingId: definition.id,
          scope: scope,
          scopeId: scopeIdValue,
        },
      } as any,
      update: {
        value: value,
        updatedAt: new Date(),
      },
      create: {
        settingId: definition.id,
        scope: scope,
        scopeId: scopeIdValue as string | null,
        value: value,
        createdBy: userId,
      },
    });

    return {
      id: settingValue.id,
      settingId: settingValue.settingId,
      scope: settingValue.scope,
      scopeId: settingValue.scopeId,
      value: settingValue.value,
      createdAt: settingValue.createdAt,
      updatedAt: settingValue.updatedAt,
      createdBy: settingValue.createdBy,
      definition: definition,
    };
  }

  /**
   * حذف قيمة إعداد معينة
   */
  async deleteSettingValue(
    key: string,
    scope: SettingScope,
    scopeId?: string
  ): Promise<boolean> {
    const definition = await this.getSettingByKey(key);

    if (!definition) {
      return false;
    }

    const result = await prisma.settingValue.deleteMany({
      where: {
        settingId: definition.id,
        scope: scope,
        scopeId: scopeId || null,
      },
    });

    return result.count > 0;
  }

  /**
   * إعادة تعيين إعداد إلى قيمته الافتراضية
   */
  async resetSetting(
    key: string,
    scope: SettingScope,
    scopeId?: string
  ): Promise<boolean> {
    return this.deleteSettingValue(key, scope, scopeId);
  }

  /**
   * حذف تعريف إعداد
   */
  async deleteSetting(key: string): Promise<boolean> {
    const result = await prisma.systemSetting.delete({
      where: { key },
    });

    return !!result;
  }

  /**
   * تعطيل أو تفعيل إعداد
   */
  async toggleSetting(key: string, isActive: boolean): Promise<SettingDefinition> {
    return prisma.systemSetting.update({
      where: { key },
      data: { isActive },
    });
  }

  /**
   * جلب الإعدادات حسب الفئة
   */
  async getSettingsByCategory(
    category: SettingCategory
  ): Promise<SettingDefinition[]> {
    return this.getSettings({ category, isActive: true });
  }

  /**
   * جلب الإعدادات لنطاق معين (مع القيم المخصصة)
   */
  async getSettingsForScope(
    scope: SettingScope,
    scopeId?: string
  ): Promise<Array<{ definition: SettingDefinition; value: any }>> {
    const definitions = await this.getSettings({ isActive: true });

    const result = await Promise.all(
      definitions.map(async (def) => {
        const settingValue = await prisma.settingValue.findFirst({
          where: {
            settingId: def.id,
            scope: scope,
            scopeId: scopeId || null,
          },
        });

        let value: any;

        if (settingValue) {
          value = this.parseValue(settingValue.value, def.type);
        } else if (def.value != null) {
          value = this.parseValue(def.value!, def.type);
        } else {
          value = this.getDefaultValue(def.type);
        }

        return { definition: def, value };
      })
    );

    return result;
  }

  /**
   * تحويل القيمة من JSON string للنوع المناسب
   */
  private parseValue(value: string, type: SettingType): any {
    try {
      switch (type) {
        case SettingType.BOOLEAN:
          return value === "true" || value === "1";
        case SettingType.NUMBER:
          return parseFloat(value);
        case SettingType.DATE:
          return value.split("T")[0];
        case SettingType.DATETIME:
          return new Date(value).toISOString();
        case SettingType.ARRAY:
        case SettingType.JSON:
          return JSON.parse(value);
        case SettingType.STRING:
        default:
          return value;
      }
    } catch {
      return value;
    }
  }

  /**
   * تحويل القيمة لنص للتخزين
   */
  stringifyValue(value: any, type: SettingType): string {
    switch (type) {
      case SettingType.BOOLEAN:
        return String(value === true || value === "true" || value === "1");
      case SettingType.NUMBER:
        return String(Number(value));
      case SettingType.ARRAY:
      case SettingType.JSON:
        return JSON.stringify(value);
      case SettingType.DATE:
      case SettingType.DATETIME:
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);
      case SettingType.STRING:
      default:
        return String(value || "");
    }
  }

  /**
   * الحصول على قيمة افتراضية حسب النوع
   */
  private getDefaultValue(type: SettingType): any {
    switch (type) {
      case SettingType.BOOLEAN:
        return false;
      case SettingType.NUMBER:
        return 0;
      case SettingType.ARRAY:
      case SettingType.JSON:
        return type === SettingType.ARRAY ? [] : {};
      case SettingType.DATE:
      case SettingType.DATETIME:
        return null;
      case SettingType.STRING:
      default:
        return "";
    }
  }

  /**
   * التحقق من صحة القيمة بناءً على النوع
   */
  private validateValue(value: string, type: SettingType): void {
    switch (type) {
      case SettingType.BOOLEAN:
        if (value !== "true" && value !== "false" && value !== "1" && value !== "0") {
          throw new Error("قيمة خاطئة لـ Boolean: يجب أن تكون true أو false");
        }
        break;
      case SettingType.NUMBER:
        if (isNaN(Number(value))) {
          throw new Error("قيمة خاطئة لـ Number: يجب أن تكون رقماً");
        }
        break;
      case SettingType.DATE:
        if (isNaN(Date.parse(value))) {
          throw new Error("قيمة خاطئة لـ Date: يجب أن تكون تاريخاً صالحاً");
        }
        break;
      case SettingType.DATETIME:
        if (isNaN(Date.parse(value))) {
          throw new Error("قيمة خاطئة لـ DateTime: يجب أن تكون تاريخاً ووقتاً صالحين");
        }
        break;
      case SettingType.ARRAY:
      case SettingType.JSON:
        try {
          JSON.parse(value);
        } catch {
          throw new Error("قيمة خاطئة لـ JSON: يجب أن تكون JSON صالح");
        }
        break;
    }
  }
}

export const settingsService = new SettingsService();
