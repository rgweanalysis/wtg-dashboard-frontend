X-Minutal Backend Phase 3 — Validation + File Profile

ما الذي تم إضافته؟
- Endpoint جديد في Cloudflare Worker:
  POST /api/xmin/profile

وظيفته:
- فحص جودة ملف X-Minutal بدون تغيير أي حسابات أو رسومات في الواجهة.
- حساب file profile:
  - عدد الصفوف والأعمدة
  - عدد الصفوف ذات timestamp غير صالح
  - عدد الصفوف بدون turbine/WTG
  - عدد الصفوف بدون قيم رقمية
  - الصفوف المكررة المحتملة
  - إحصاءات الأعمدة/المتغيرات الرقمية: min / max / average / missing / nonNumeric
  - Quality score وتحذيرات validation

مهم:
- هذا التعديل Backend فقط من ناحية الوظيفة، والواجهة الحالية لا تعتمد عليه بعد.
- لا يغير Exceedances أو Temperature Overview أو Curves أو أي نتائج ظاهرة.
- الهدف تجهيز آمن قبل نقل حسابات X-Minutal الثقيلة لاحقًا.

بعد النسخ:
- حدّث Cloudflare Worker من backend-cloudflare-worker/src/index.js
- Summary المقترح في GitHub Desktop:
  Add X-Minutal backend file profile validation
