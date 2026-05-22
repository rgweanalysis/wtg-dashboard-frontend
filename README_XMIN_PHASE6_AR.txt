X-Minutal Backend Phase 6 — Exceedances Summary

تم نقل تجهيز Summary الخاص بجدول Exceedances analysis إلى Cloudflare Worker عبر endpoint جديد:
/api/xmin/exceedance-summary

الذي تم نقله:
- حساب صفوف exceedances من بيانات X-Minutal المفلترة.
- تجميع النتائج حسب التربينة.
- حساب Exceeded limit count لكل تربينة.
- ترتيب الملخص حسب العدد من الأكبر للأصغر داخل الباك اند.

ما لم يتغير:
- شكل جدول Exceedances analysis.
- زر Details والواجهة.
- Temperature overview chart.
- فلاتر X-Minutal الحالية.

مهم:
هذه النسخة تتطلب تحديث Cloudflare Worker بنسخ محتوى:
backend-cloudflare-worker/src/index.js
ثم Save and deploy.
