/**
 * نظام إشعارات البريد الإلكتروني للأمان
 * Security Email Notification System
 */

import { logInfo, logError, logWarn } from '@/utils/logger'

// واجهة إعدادات البريد الإلكتروني
export interface EmailConfig {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  fromEmail: string
  fromName: string
}

// واجهة البريد الإلكتروني
export interface EmailMessage {
  to: string
  subject: string
  html: string
  text?: string
}

// إعدادات البريد الإلكتروني (من البيئة)
export function getEmailConfig(): EmailConfig {
  return {
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587'),
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
    fromEmail: process.env.FROM_EMAIL || 'noreply@alketan.com',
    fromName: process.env.FROM_NAME || 'Alketan Hotel',
  }
}

// قالب بريد إلكتروني عام
function createEmailTemplate(
  title: string,
  content: string,
  footer: string,
  actionButton?: { text: string; url: string }
): string {
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #1a365d;
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      padding: 30px;
      color: #333;
      line-height: 1.8;
    }
    .alert-box {
      background-color: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
    }
    .alert-box.warning {
      background-color: #fff3cd;
      border-color: #ffc107;
    }
    .alert-box.danger {
      background-color: #f8d7da;
      border-color: #f5c6cb;
    }
    .alert-box.success {
      background-color: #d4edda;
      border-color: #c3e6cb;
    }
    .info-box {
      background-color: #e7f3ff;
      border: 1px solid #b8daff;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
    }
    .button {
      display: inline-block;
      padding: 12px 30px;
      background-color: #1a365d;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #666;
    }
    .divider {
      height: 1px;
      background-color: #eee;
      margin: 20px 0;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .details-table th, .details-table td {
      padding: 10px;
      text-align: right;
      border-bottom: 1px solid #eee;
    }
    .details-table th {
      color: #666;
      font-weight: normal;
      width: 40%;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏨 فندق الأكتان</h1>
      <p>Alketan Hotel</p>
    </div>
    <div class="content">
      <h2>${title}</h2>
      ${content}
      ${actionButton ? `<a href="${actionButton.url}" class="button">${actionButton.text}</a>` : ''}
    </div>
    <div class="footer">
      ${footer}
    </div>
  </div>
</body>
</html>
`
}

// إرسال بريد إلكتروني (محاكاة في التطوير)
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    const config = getEmailConfig()

    // في الإنتاج، استخدم nodemailer أو خدمة SMTP حقيقية
    // هذا التنفيذ للتطوير والاختبار

    logInfo('Email sent (simulated)', {
      to: message.to,
      subject: message.subject,
    })

    // محاكاة نجاح الإرسال
    return true

  } catch (error) {
    logError('Failed to send email', { error, to: message.to, subject: message.subject })
    return false
  }
}

// إشعار تسجيل دخول جديد
export async function sendLoginNotification(
  email: string,
  userName: string,
  details: {
    ip: string
    device: string
    location?: string
    time: Date
  }
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>تم تسجيل دخول إلى حسابك في فندق الأكتان من جهاز جديد:</p>
    <div class="info-box">
      <table class="details-table">
        <tr>
          <th>الوقت:</th>
          <td>${details.time.toLocaleString('ar-SA')}</td>
        </tr>
        <tr>
          <th>عنوان IP:</th>
          <td>${details.ip}</td>
        </tr>
        <tr>
          <th>الموقع:</th>
          <td>${details.location || 'غير معروف'}</td>
        </tr>
        <tr>
          <th>الجهاز:</th>
          <td>${details.device}</td>
        </tr>
      </table>
    </div>
    <p>إذا لم تكن أنت من قام بهذا الإجراء، نرجو النقر على الزر أدناه لتأمين حسابك:</p>
  `

  const message: EmailMessage = {
    to: email,
    subject: '⚠️ تسجيل دخول جديد إلى حسابك - فندق الأكتان',
    html: createEmailTemplate(
      'تنبيه أمان مهم',
      content,
      'إذا كان هذا الإجراء منك، يمكنك تجاهل هذا البريد.<br>إذا لم يكن كذلك، تأكد من تغيير كلمة مرورك فوراً.',
      {
        text: 'تأمين حسابي',
        url: `${process.env.APP_URL || 'http://localhost:3000'}/security`,
      }
    ),
  }

  return sendEmail(message)
}

// إشعار محاولة تسجيل دخول فاشلة
export async function sendFailedLoginNotification(
  email: string,
  userName: string,
  details: {
    ip: string
    location?: string
    attempts: number
    time: Date
  }
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>تم رصد ${details.attempts} محاولات لتسجيل الدخول الفاشلة إلى حسابك:</p>
    <div class="alert-box ${details.attempts >= 5 ? 'danger' : 'warning'}">
      <table class="details-table">
        <tr>
          <th>الوقت:</th>
          <td>${details.time.toLocaleString('ar-SA')}</td>
        </tr>
        <tr>
          <th>عنوان IP:</th>
          <td>${details.ip}</td>
        </tr>
        <tr>
          <th>الموقع:</th>
          <td>${details.location || 'غير معروف'}</td>
        </tr>
        <tr>
          <th>عدد المحاولات:</th>
          <td>${details.attempts}</td>
        </tr>
      </table>
    </div>
    ${details.attempts >= 5 ? '<p><strong>تم قفل حسابك مؤقتاً لمدة 15 دقيقة لأمانك.</strong></p>' : ''}
    <p>إذا كنت أنت من حاول تسجيل الدخول، يمكنك تجاهل هذا الإشعار.</p>
  `

  const message: EmailMessage = {
    to: email,
    subject: '⚠️ محاولات تسجيل دخول فاشلة - فندق الأكتان',
    html: createEmailTemplate(
      'تنبيه أمان - محاولات تسجيل دخول',
      content,
      'إذا لم تكن أنت من حاول، نوصي بتغيير كلمة مرورك فوراً.',
      {
        text: 'تغيير كلمة المرور',
        url: `${process.env.APP_URL || 'http://localhost:3000'}/auth/change-password`,
      }
    ),
  }

  return sendEmail(message)
}

// إشعار تفعيل المصادقة الثنائية
export async function send2FAEnabledNotification(
  email: string,
  userName: string
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>🎉 تم تفعيل المصادقة الثنائية (2FA) بنجاح على حسابك!</p>
    <div class="alert-box success">
      <p><strong>مستوى أمان حسابك أعلى الآن.</strong></p>
      <p>ستحتاج إلى إدخال رمز التحقق من تطبيق المصادقة في كل مرة تقوم فيها بتسجيل الدخول.</p>
    </div>
    <p><strong>مهم:</strong> تأكد من حفظ رموز النسخ الاحتياطي التي تلقيتها عند تفعيل الميزة.</p>
    <p>إذا لم تكن أنت من فعل هذا، تواصل معنا فوراً.</p>
  `

  const message: EmailMessage = {
    to: email,
    subject: '✅ تم تفعيل المصادقة الثنائية - فندق الأكتان',
    html: createEmailTemplate(
      'تم تفعيل المصادقة الثنائية',
      content,
      'إذا كان هذا الإجراء منك، يمكنك تجاهل هذا البريد.'
    ),
  }

  return sendEmail(message)
}

// إشعار تعطيل المصادقة الثنائية
export async function send2FADisabledNotification(
  email: string,
  userName: string,
  reason: string
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>⚠️ تم تعطيل المصادقة الثنائية (2FA) على حسابك.</p>
    <div class="alert-box warning">
      <p><strong>السبب:</strong> ${reason}</p>
    </div>
    <p>حسابك الآن أقل أماناً. نوصي بإعادة تفعيل المصادقة الثنائية لحماية حسابك.</p>
    <p>إذا لم تكن أنت من فعل هذا، تواصل معنا فوراً.</p>
  `

  const message: EmailMessage = {
    to: email,
    subject: '⚠️ تم تعطيل المصادقة الثنائية - فندق الأكتان',
    html: createEmailTemplate(
      'تنبيه أمان - تعطيل المصادقة الثنائية',
      content,
      'إذا لم يكن هذا الإجراء منك، تأكد من تغيير كلمة مرورك فوراً.',
      {
        text: 'إعادة تفعيل 2FA',
        url: `${process.env.APP_URL || 'http://localhost:3000'}/security/2fa`,
      }
    ),
  }

  return sendEmail(message)
}

// إشعار تغيير كلمة المرور
export async function sendPasswordChangedNotification(
  email: string,
  userName: string,
  details: {
    ip: string
    device: string
    time: Date
  }
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>تم تغيير كلمة المرور الخاصة بحسابك بنجاح.</p>
    <div class="info-box">
      <table class="details-table">
        <tr>
          <th>الوقت:</th>
          <td>${details.time.toLocaleString('ar-SA')}</td>
        </tr>
        <tr>
          <th>عنوان IP:</th>
          <td>${details.ip}</td>
        </tr>
        <tr>
          <th>الجهاز:</th>
          <td>${details.device}</td>
        </tr>
      </table>
    </div>
    <p>إذا لم تكن أنت من فعل هذا، تواصل معنا فوراً.</p>
  `

  const message: EmailMessage = {
    to: email,
    subject: '✅ تم تغيير كلمة المرور - فندق الأكتان',
    html: createEmailTemplate(
      'تغيير كلمة المرور',
      content,
      'إذا لم يكن هذا الإجراء منك، تأكد من تغيير كلمة مرورك فوراً.'
    ),
  }

  return sendEmail(message)
}

// إشعار إنهاء جلسة
export async function sendSessionTerminatedNotification(
  email: string,
  userName: string,
  details: {
    reason: string
    device: string
    time: Date
  }
): Promise<boolean> {
  const content = `
    <p>مرحباً ${userName}،</p>
    <p>تم إنهاء إحدى جلساتك على حسابك.</p>
    <div class="info-box">
      <table class="details-table">
        <tr>
          <th>السبب:</th>
          <td>${details.reason}</td>
        </tr>
        <tr>
          <th>الجهاز:</th>
          <td>${details.device}</td>
        </tr>
        <tr>
          <th>الوقت:</th>
          <td>${details.time.toLocaleString('ar-SA')}</td>
        </tr>
      </table>
    </div>
  `

  const message: EmailMessage = {
    to: email,
    subject: '📴 تم إنهاء جلسة - فندق الأكتان',
    html: createEmailTemplate(
      'إنهاء جلسة',
      content,
      'إذا لم يكن هذا الإجراء منك، راجع أمان حسابك.'
    ),
  }

  return sendEmail(message)
}

// إشعار نشاط مشبوه
export async function sendSuspiciousActivityNotification(
  email: string,
  userName: string,
  activities: Array<{
    type: string
    description: string
    severity: string
    details: Record<string, any>
  }>
): Promise<boolean> {
  const activitiesHtml = activities
    .map(
      (activity) => `
      <div class="alert-box ${activity.severity === 'critical' ? 'danger' : 'warning'}">
        <strong>${activity.type}</strong>
        <p>${activity.description}</p>
        <small>${JSON.stringify(activity.details)}</small>
      </div>
    `
    )
    .join('')

  const content = `
    <p>مرحباً ${userName}،</p>
    <p>🚨 تم رصد نشاط مشبوه على حسابك:</p>
    ${activitiesHtml}
    <p>إذا لم تكن أنت من قام بهذه الإجراءات، نوصي بما يلي:</p>
    <ol>
      <li>تغيير كلمة مرورك فوراً</li>
      <li>تفعيل المصادقة الثنائية إذا لم تكن مفعلة</li>
      <li>مراجعة جلساتك النشطة</li>
      <li>التواصل معنا إذا كنت بحاجة للمساعدة</li>
    </ol>
  `

  const message: EmailMessage = {
    to: email,
    subject: '🚨 تنبيه أمان: نشاط مشبوه - فندق الأكتان',
    html: createEmailTemplate(
      'نشاط مشبوه على حسابك',
      content,
      'إذا كنت بحاجة للمساعدة، تواصل مع فريق الدعم.',
      {
        text: 'مراجعة أمان حسابي',
        url: `${process.env.APP_URL || 'http://localhost:3000'}/security`,
      }
    ),
  }

  return sendEmail(message)
}
