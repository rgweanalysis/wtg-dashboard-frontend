# X-Minutal Backend Phase 1

هذا التعديل خفيف وآمن:
- أضيف endpoint جديد في Cloudflare Worker: /api/xmin/inspect
- وظيفته قراءة ملف X-Minutal واكتشاف الأعمدة فقط.
- لم يتم تغيير واجهة X-Minutal أو حساباتها الحالية في الفرونت.
- الهدف هو تجهيز أول خطوة للانتقال التدريجي بدون التأثير على الجداول أو الرسومات.

بعد رفع الكود إلى Cloudflare Worker يمكن اختبار endpoint لاحقًا من الفرونت أو بأداة API.
