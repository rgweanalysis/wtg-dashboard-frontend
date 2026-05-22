X-Minutal Backend Phase 2 — Metadata only

هذه مرحلة خفيفة وآمنة.
تمت إضافة endpoint جديد في Cloudflare Worker:
/api/xmin/metadata

الوظيفة:
- قراءة ملف X-Minutal
- إرجاع عدد الصفوف والأعمدة
- اكتشاف قائمة التربينات
- اكتشاف قائمة المتغيرات / الأعمدة الرقمية
- استخراج أول وآخر Timestamp
- استخراج قائمة الأيام
- إرجاع validation warnings فقط

لم يتم تغيير حسابات X-Minutal الحالية أو الرسومات أو الفلاتر.
