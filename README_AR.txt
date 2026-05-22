نسخة Backend جديدة:

- AAW محفوظة على Cloudflare Worker.
- AWS الحسابات الأساسية محفوظة على Cloudflare Worker.
- Turbine Profile Phase 1 محفوظ على Cloudflare Worker.
- Limiting Events و Emergency Pre-alarms تم نقل حساباتهم للباك اند.

التشغيل:
1) انسخ محتوى backend-cloudflare-worker/src/index.js إلى Cloudflare Worker ثم Save and deploy.
2) افتح frontend/index.html وجرب التابتين داخل AWS.


تحديث: تم إضافة تابة Pause Pre-alarms ونقل منطق البحث عن الإنذارات/التحذيرات قبل Windturbine PAUSE إلى Cloudflare Worker.


Fix: moved Pause Pre-alarms frontend script outside the embedded frame template to prevent visible code leakage in the page.

تعديل: إصلاح مكان تابة Pause Pre-alarms لتظهر بجانب Emergency Pre-alarms، وإظهار محتواها أسفل شريط التابات، ومنع بقاء أكثر من تابة محددة في نفس الوقت.

تحديث: تم إصلاح تسريب كود Pause Pre-alarms بإزالة سكريبت التابة من قالب التقرير الداخلي وتركه كسكريبت عادي في نهاية الصفحة فقط.
- Emergency Pre-alarms: تم تطبيق نفس منطق Lookback الصارم؛ يتم احتساب Alarm/Warning فقط إذا كان وقت البداية داخل آخر X دقيقة قبل بداية Emergency، وليس لمجرد أنه ما زال Active داخل النافذة.
