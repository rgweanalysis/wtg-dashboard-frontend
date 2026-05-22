X-Minutal Backend Phase 4 — Details Preview

تمت إضافة endpoint خفيف جديد في Cloudflare Worker:

/api/xmin/details-preview

وظيفته:
- قراءة ملف X-Minutal في الباك اند.
- فلترة عينة تفاصيل حسب التربينة / المتغير / التاريخ / البحث النصي.
- إرجاع صفوف جاهزة للمعاينة أو الاستخدام لاحقًا في زر Details.

مهم:
- لم يتم تغيير أي حسابات حالية في X-Minutal.
- لم يتم تغيير الرسومات أو الفلاتر أو Exceedances الحالية.
- هذه مرحلة تجهيز آمنة قبل نقل تفاصيل Exceedances أو Curves لاحقًا.
