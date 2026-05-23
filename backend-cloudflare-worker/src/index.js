function corsHeaders(request) {
  // Permissive CORS for local file:// testing and deployed frontend.
  // The frontend is currently opened locally, so the browser sends Origin: null.
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "content-type, authorization, x-requested-with, accept, origin",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "content-type"
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return withCors(json({ ok: true, service: "WTG Cloudflare Backend", status: "ready" }), request);
      }
      if (url.pathname === "/api/aaw/compare" && request.method === "POST") {
        return withCors(await handleCompare(request), request);
      }
      if (url.pathname === "/api/aws/parse" && request.method === "POST") {
        return withCors(await handleAwsParse(request), request);
      }
      if (url.pathname === "/api/aws/table" && request.method === "POST") {
        return withCors(await handleAwsTable(request), request);
      }
      if (url.pathname === "/api/aws/summary" && request.method === "POST") {
        return withCors(await handleAwsSummary(request), request);
      }
      if (url.pathname === "/api/aws/timeline" && request.method === "POST") {
        return withCors(await handleAwsTimeline(request), request);
      }
      if (url.pathname === "/api/aws/details" && request.method === "POST") {
        return withCors(await handleAwsDetails(request), request);
      }
      if (url.pathname === "/api/turbine-profile/aws" && request.method === "POST") {
        return withCors(await handleTurbineProfileAws(request), request);
      }
      if (url.pathname === "/api/aws/limiting-events" && request.method === "POST") {
        return withCors(await handleAwsLimitingEvents(request), request);
      }
      if (url.pathname === "/api/aws/emergency-prealarms" && request.method === "POST") {
        return withCors(await handleAwsEmergencyPrealarms(request), request);
      }
      if (url.pathname === "/api/aws/pause-prealarms" && request.method === "POST") {
        return withCors(await handleAwsPausePrealarms(request), request);
      }
      if (url.pathname === "/api/xmin/inspect" && request.method === "POST") {
        return withCors(await handleXminInspect(request), request);
      }
      if (url.pathname === "/api/xmin/metadata" && request.method === "POST") {
        return withCors(await handleXminMetadata(request), request);
      }
      if (url.pathname === "/api/xmin/profile" && request.method === "POST") {
        return withCors(await handleXminProfile(request), request);
      }
      if (url.pathname === "/api/xmin/exceedance-summary" && request.method === "POST") {
        return withCors(await handleXminExceedanceSummary(request), request);
      }
      if (url.pathname === "/api/xmin/exceedance-details" && request.method === "POST") {
        return withCors(await handleXminExceedanceDetails(request), request);
      }
      if (url.pathname === "/api/xmin/details-preview" && request.method === "POST") {
        return withCors(await handleXminDetailsPreview(request), request);
      }
      return withCors(json({ ok: false, error: "Route not found" }, 404), request);
    } catch (err) {
      return withCors(json({ ok: false, error: err && err.message ? err.message : String(err) }, 500), request);
    }
  }
};

async function handleCompare(request) {
  const form = await request.formData();
  const todayFile = form.get("today");
  const yesterdayFile = form.get("yesterday");
  const dayBeforeFile = form.get("daybefore") || form.get("dayBefore");
  let config = {};
  try { config = JSON.parse(String(form.get("config") || "{}")); } catch (_) { config = {}; }

  if (!todayFile || typeof todayFile.text !== "function") return json({ ok:false, error:"Missing today file" }, 400);
  if (!yesterdayFile || typeof yesterdayFile.text !== "function") return json({ ok:false, error:"Missing yesterday file" }, 400);

  const todayParsed = parseCSVSmart(await todayFile.text());
  const yesterdayParsed = parseCSVSmart(await yesterdayFile.text());
  const dayBeforeParsed = dayBeforeFile && typeof dayBeforeFile.text === "function"
    ? parseCSVSmart(await dayBeforeFile.text())
    : { headers: [], data: [] };

  const colsT = mergeColumns(config?.columns?.today, autoMapColumns(todayParsed.headers));
  const colsY = mergeColumns(config?.columns?.yesterday, autoMapColumns(yesterdayParsed.headers));
  const colsD = mergeColumns(config?.columns?.daybefore, autoMapColumns(dayBeforeParsed.headers));

  if (!colsT.device || !colsT.alarm || !colsY.device || !colsY.alarm) {
    return json({ ok:false, error:"Could not identify turbine/alarm columns for today and yesterday." }, 400);
  }
  if (dayBeforeParsed.data.length) {
    if (!colsD.device) colsD.device = colsY.device;
    if (!colsD.alarm) colsD.alarm = colsY.alarm;
    if (!colsD.desc) colsD.desc = colsY.desc;
    if (!colsD.time) colsD.time = colsY.time;
  }

  const includeTime = !!config?.options?.includeTime;
  const normalize = config?.options?.normalize !== false;
  const statusOnly = !!config?.options?.statusOnly;

  const filterActive = (rows) => {
    if (!statusOnly) return rows;
    const keys = Object.keys(rows[0] || {});
    const statusKey = keys.find(k => /^(status|state)$/i.test(String(k).trim()));
    if (!statusKey) return rows;
    return rows.filter(r => String(r[statusKey] || "").toUpperCase().includes("ACTIVE"));
  };

  const rowsT = filterActive(todayParsed.data);
  const rowsY = filterActive(yesterdayParsed.data);
  const hasDayBefore = dayBeforeParsed.data.length > 0;
  const rowsD = hasDayBefore ? filterActive(dayBeforeParsed.data) : [];

  const idxT = indexBy(rowsT, colsT, includeTime, normalize);
  const idxY = indexBy(rowsY, colsY, includeTime, normalize);
  const idxD = hasDayBefore ? indexBy(rowsD, colsD, includeTime, normalize) : new Map();

  const repeated = [];
  const news = [];
  const cleared = [];
  const repeated3 = [];

  for (const [k, vT] of idxT.entries()) {
    if (idxY.has(k)) {
      const vY = idxY.get(k);
      const tRow = vT.row;
      const yRow = vY.row;
      const desc = colsT.desc ? (tRow[colsT.desc] || "") : (colsY.desc ? (yRow[colsY.desc] || "") : "");
      const p = parseKey(k);
      repeated.push({ device: p.device, alarm: p.alarm, description: desc, count: `${vT.count}/${vY.count}` });
    } else {
      const tRow = vT.row;
      const desc = colsT.desc ? (tRow[colsT.desc] || "") : "";
      const p = parseKey(k);
      news.push({ device: p.device, alarm: p.alarm, description: desc });
    }
  }

  for (const [k, vY] of idxY.entries()) {
    if (!idxT.has(k)) {
      const yRow = vY.row;
      const desc = colsY.desc ? (yRow[colsY.desc] || "") : "";
      const p = parseKey(k);
      cleared.push({ device: p.device, alarm: p.alarm, description: desc });
    }
  }

  if (hasDayBefore) {
    for (const [k, vT] of idxT.entries()) {
      if (idxY.has(k) && idxD.has(k)) {
        const tRow = vT.row;
        const p = parseKey(k);
        const desc = (colsT.desc && tRow[colsT.desc])
          ? tRow[colsT.desc]
          : (colsY.desc && idxY.get(k).row[colsY.desc])
            ? idxY.get(k).row[colsY.desc]
            : (colsD.desc && idxD.get(k).row[colsD.desc])
              ? idxD.get(k).row[colsD.desc]
              : "";
        repeated3.push({ device: p.device, alarm: p.alarm, description: desc });
      }
    }
  }

  const groupedRepeated = groupResultsByAlarm(repeated, true);
  const groupedNews = groupResultsByAlarm(news, false);
  const groupedCleared = groupResultsByAlarm(cleared, false);
  const groupedRepeated3 = groupResultsByAlarm(repeated3, false);
  const repeated3Set = groupedRepeated3.map(entry => entry.alarm);
  const repeated3Pairs = [];
  if (hasDayBefore) {
    for (const k of idxT.keys()) {
      if (idxY.has(k) && idxD.has(k)) {
        const parts = String(k).split("||");
        if (parts.length >= 2) repeated3Pairs.push(parts[0] + "||" + parts[1]);
      }
    }
  }

  const lubrication = buildLubricationRowsFromToday(rowsT, colsT);

  return json({
    ok: true,
    backend: "cloudflare-worker",
    options: { includeTime, normalize, statusOnly },
    columns: { today: colsT, yesterday: colsY, daybefore: colsD },
    stats: {
      todayRows: todayParsed.data.length,
      yesterdayRows: yesterdayParsed.data.length,
      dayBeforeRows: dayBeforeParsed.data.length,
      filteredTodayRows: rowsT.length,
      filteredYesterdayRows: rowsY.length,
      filteredDayBeforeRows: rowsD.length,
      repeated: groupedRepeated.length,
      news: groupedNews.length,
      cleared: groupedCleared.length,
      repeated3: hasDayBefore ? groupedRepeated3.length : null,
      lubrication: lubrication.length,
      hasDayBefore
    },
    results: {
      repeated: groupedRepeated.map(r => ({ ...r, highlight: repeated3Set.includes(r.alarm) })),
      news: groupedNews.map(r => ({ ...r, highlight: false })),
      cleared: groupedCleared.map(r => ({ ...r, highlight: false })),
      repeated3: groupedRepeated3,
      lubrication
    },
    repeated3Set,
    repeated3Pairs: Array.from(new Set(repeated3Pairs))
  });
}


async function handleAwsParse(request) {
  const form = await request.formData();
  const file = form.get("file") || form.get("aws");
  if (!file || typeof file.text !== "function") {
    return json({ ok:false, error:"Missing AWS file" }, 400);
  }
  const name = String(file.name || "");
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "xls" || ext === "xlsx") {
    return json({ ok:false, error:"AWS backend currently supports CSV/TXT. Please export the AWS file as CSV for backend parsing." }, 400);
  }
  const parsed = parseCSVSmart(await file.text());
  const colMap = autoMapAwsColumns(parsed.headers);
  if (!colMap.device || !colMap.event || !colMap.category) {
    return json({
      ok:false,
      error:"Could not identify the required AWS columns: device, event, and category.",
      header: parsed.headers,
      colMap
    }, 400);
  }
  const data = parsed.data;
  const events = Array.from(new Set(data.map(row => awsEventName(row, colMap)).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true}));
  const categories = buildAwsCategoryCounts(data, colMap);
  return json({
    ok:true,
    backend:"cloudflare-worker",
    phase:"aws-parse-column-map",
    header: parsed.headers,
    data,
    colMap,
    meta:{
      filename:name,
      rows:data.length,
      delimiter:parsed.delimiter,
      events,
      categories
    }
  });
}

function autoMapAwsColumns(cols) {
  const low = cols.map(c => String(c).trim().toLowerCase());
  const find = (arr) => {
    for (const cand of arr) {
      const target = String(cand).toLowerCase();
      const i = low.findIndex(h => h === target || h.includes(target));
      if (i >= 0) return cols[i];
    }
    return null;
  };
  const colMap = {};
  colMap.device = find(['device','wtg','turbine','التربينة','التربينات','التركيبة','(device/wtg)','اسم التوربينة']);
  colMap.event = find(['event','event name','alarm','alarm name','اسم الإنذار','event/subevent/category','subevent','subevent / categorization']);
  colMap.category = find(['category','الفئة','categorization','توصيف','category/event']);
  colMap.duration = find(['duration','مدة','duration (hh:mm:ss)','time','total duration']);
  colMap.start = find(['start date','start','start time','بداية الحدث','تاريخ البداية']);
  colMap.end = find(['end date','end','end time','نهاية الحدث','تاريخ النهاية']);
  colMap.subevent = find(['subevent','subevent/categorization','subevent / categorization','categorization description','categorisation description','subevent categorization']);
  if (!colMap.event) colMap.event = find(['subevent','subevent / categorization']);
  return colMap;
}

function awsEventName(row, colMap) {
  const primary = colMap.event ? String(row[colMap.event] || '').trim() : '';
  if (primary) return primary;
  const sub = colMap.subevent ? String(row[colMap.subevent] || '').trim() : '';
  return sub;
}

function awsCategoryKey(row, colMap) {
  const raw = colMap.category ? String(row[colMap.category] || '').trim() : '';
  const hasSub = colMap.subevent && String(row[colMap.subevent] || '').trim() !== '';
  if (hasSub) return '__OTHER__';
  if (!raw || raw.toLowerCase() === 'unknown' || raw === 'غير معروف' || raw === 'بدون فئة') return '__OTHER__';
  const lc = raw.toLowerCase();
  if (lc.includes('alarm') || raw === 'إنذار') return 'Alarm';
  if (lc.includes('state') || raw === 'حالة') return 'State';
  if (lc.includes('warning') || raw === 'تحذير') return 'Warning';
  return '__OTHER__';
}

function buildAwsCategoryCounts(data, colMap) {
  const counts = {};
  for (const row of data) {
    const key = awsCategoryKey(row, colMap);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}




async function handleAwsTimeline(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  if (!data.length) return json({ ok:true, days: [], metrics:{ deviceCount:0, displayRangeLabel:"—" } });
  if (!colMap.device || !colMap.category) {
    return json({ ok:false, error:"Missing AWS column map for device/category." }, 400);
  }
  const result = buildAwsTimelineModel(data, colMap, filters);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-running-timeline", ...result });
}

function buildAwsTimelineModel(data, colMap, filters) {
  const checkedCats = Array.isArray(filters.categories) ? filters.categories : [];
  const selectedEvents = Array.isArray(filters.selectedEvents) ? filters.selectedEvents.filter(Boolean) : [];
  const allSelected = !!filters.allSelected || selectedEvents.includes('__ALL__') || selectedEvents.length === 0;
  const pickedNonRunning = selectedEvents.filter(v => v !== '__ALL__' && !isAwsRunningEvent(v));
  const deviceFilterTerm = String(filters.deviceFilterTerm || '').trim().toLowerCase();
  const unifiedNone = !!filters.unifiedDeviceNoneMode;
  const unifiedSet = new Set((Array.isArray(filters.unifiedSelectedTurbines) ? filters.unifiedSelectedTurbines : []).map(v => normalizeDeviceMatch(v)).filter(Boolean));
  const startFilter = filters.startDate ? parseAwsFilterDate(filters.startDate, filters.startTime || '00:00') : null;
  const endFilter = filters.endDate ? parseAwsFilterDate(filters.endDate, filters.endTime || '23:59') : null;

  if (unifiedNone) return { days: [], metrics:{ alarmLabel: awsTimelineAlarmLabel(selectedEvents, allSelected), deviceCount:0, displayRangeLabel:"—", note:"No turbines selected." } };

  function includeAlarmEvent(evName) {
    if (!evName || isAwsRunningEvent(evName)) return false;
    if (!pickedNonRunning.length) return true;
    return pickedNonRunning.includes(evName);
  }

  const items = [];
  const deviceSet = new Set();
  const dayStats = {};

  for (const row of data) {
    const categoryKey = awsCategoryKey(row, colMap);
    if (checkedCats.length && !checkedCats.includes(categoryKey)) continue;

    const devRaw = row[colMap.device];
    const device = validAwsDevice(devRaw);
    if (!device) continue;
    if (deviceFilterTerm && !awsDeviceMatchesTerm(device, deviceFilterTerm)) continue;
    if (unifiedSet.size && !unifiedSet.has(normalizeDeviceMatch(device))) continue;

    const evName = awsEventName(row, colMap);
    if (!evName) continue;
    const include = isAwsRunningEvent(evName) || includeAlarmEvent(evName);
    if (!include) continue;

    const dates = parseAwsRowDates(row, colMap);
    if (!dates.start || !dates.end) continue;
    const clip = clipAwsDates(dates.start, dates.end, startFilter, endFilter);
    if (!clip.start || !clip.end) continue;

    deviceSet.add(device);
    const segs = splitAwsDatesByDay(clip.start, clip.end);
    for (const seg of segs) {
      const dayKey = awsYmd(seg.s);
      dayStats[dayKey] = (dayStats[dayKey] || 0) + seg.sec;
      const base = new Date(seg.s.getFullYear(), seg.s.getMonth(), seg.s.getDate(), 0, 0, 0, 0);
      const startMin = Math.max(0, (seg.s.getTime() - base.getTime()) / 60000);
      let endMin = (seg.e.getTime() - base.getTime()) / 60000;
      if (endMin <= startMin || endMin >= 1439.999) endMin = 1440;
      items.push({
        dayKey,
        device,
        alarm: evName,
        startMin,
        endMin,
        startDate: seg.s,
        endDate: seg.e,
        durationSec: seg.sec
      });
    }
  }

  const displayDayKeys = selectAwsDisplayDays(dayStats, filters.startDate || '', filters.endDate || '');
  if (!displayDayKeys.length) {
    return { days: [], metrics:{ alarmLabel: awsTimelineAlarmLabel(selectedEvents, allSelected), deviceCount:0, displayRangeLabel:"—", note:"No matching AWS timeline rows." } };
  }

  const displayRangeLabel = displayDayKeys.length === 1 ? displayDayKeys[0] : `${displayDayKeys[0]} → ${displayDayKeys[displayDayKeys.length - 1]}`;
  const rowsByDayTurbine = new Map();
  for (const item of items) {
    if (!displayDayKeys.includes(item.dayKey)) continue;
    const key = item.dayKey + '||' + item.device;
    if (!rowsByDayTurbine.has(key)) rowsByDayTurbine.set(key, { dayKey:item.dayKey, device:item.device, rows:[] });
    rowsByDayTurbine.get(key).rows.push(item);
  }

  const days = displayDayKeys.map(dayKey => {
    const turbines = Array.from(rowsByDayTurbine.values())
      .filter(x => x.dayKey === dayKey)
      .sort((a,b) => String(a.device).localeCompare(String(b.device), 'en', {numeric:true}))
      .map(info => buildAwsTimelineTurbine(info));
    return {
      dayKey,
      title: `${awsWeekdayName(dayKey)} | ${dayKey}`,
      turbines
    };
  });

  const note = displayDayKeys.length === 1
    ? `Showing actual turbine running timeline for ${displayRangeLabel}. Green appears only when the visible state is Windturbine RUNNING. If Windturbine RUNNING is not present, the turbine is not shown as running.`
    : `Showing actual turbine running timeline from ${displayRangeLabel}. Green appears only when the visible state is Windturbine RUNNING. If Windturbine RUNNING is not present, the turbine is not shown as running.`;

  return {
    days,
    metrics: {
      alarmLabel: awsTimelineAlarmLabel(selectedEvents, allSelected),
      deviceCount: deviceSet.size,
      displayRangeLabel,
      note
    }
  };
}

function buildAwsTimelineTurbine(info) {
  const trows = (info.rows || []).slice().sort((a,b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const running = mergeAwsMinuteIntervals(trows.filter(x => isAwsRunningEvent(x.alarm)).map(x => ({ startMin:x.startMin, endMin:x.endMin })));
  const alarmNames = Array.from(new Set(trows.filter(x => !isAwsRunningEvent(x.alarm)).map(x => x.alarm))).sort((a,b)=>String(a).localeCompare(String(b),'en',{numeric:true}));

  const runningSegments = running.map(seg => {
    const stopInfo = seg.endMin < 1440 ? findAwsStoppingAlarmForRunningSeg(seg, trows) : null;
    const durMin = Math.max(0, Number(seg.endMin || 0) - Number(seg.startMin || 0));
    return {
      startMin: seg.startMin,
      endMin: seg.endMin,
      startText: awsHmsFromMin(seg.startMin),
      endText: seg.endMin >= 1440 ? '24:00:00' : awsHmsFromMin(seg.endMin),
      durationText: formatSecondsDuration(durMin * 60),
      label: durMin > 90 ? compactAwsDurationMinutes(durMin) : '',
      stopAlarm: stopInfo ? stopInfo.alarm : (seg.endMin < 1440 ? 'No matching alarm found' : ''),
      stopAlarmTime: stopInfo ? stopInfo.time : ''
    };
  });

  const events = alarmNames.map(name => {
    const segments = trows.filter(x => x.alarm === name).sort((a,b)=>a.startMin-b.startMin || a.endMin-b.endMin).map(seg => {
      const effect = getAwsActualEventEffect(seg, running, trows);
      const durMin = Math.max(0, Number(seg.endMin || 0) - Number(seg.startMin || 0));
      return {
        startMin: seg.startMin,
        endMin: seg.endMin,
        startText: awsHms(seg.startDate),
        endText: seg.endMin >= 1440 ? '24:00:00' : awsHms(seg.endDate),
        durationText: formatSecondsDuration(seg.durationSec || durMin * 60),
        label: durMin > 60 ? compactAwsDurationMinutes(durMin) : '',
        stop: effect.stop,
        beforeState: effect.beforeState,
        duringState: effect.duringState,
        afterState: effect.afterState,
        resultLabel: effect.resultLabel,
        code: effect.code
      };
    });
    return { name, segments };
  });

  return { device: info.device, running: runningSegments, events };
}

function awsTimelineAlarmLabel(selectedEvents, allSelected) {
  const names = (Array.isArray(selectedEvents) ? selectedEvents : []).filter(v => v && v !== '__ALL__');
  if (allSelected || !names.length) return 'Running vs alarms';
  if (names.length === 1) return names[0];
  return `${names.length} selected alarms`;
}

function validAwsDevice(raw) {
  if (!raw) return '';
  const dev = String(raw).trim();
  if (!dev || dev.toLowerCase() === 'unknown' || dev === 'غير معروف') return '';
  return dev;
}

function isAwsRunningEvent(name) {
  const s = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(windturbine\s+)?running$/.test(s);
}


function isAwsWindturbineStateEvent(name) {
  const s = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return /^windturbine\s+/.test(s);
}

function isAwsNonRunningTurbineStateEvent(name) {
  const s = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!/^windturbine\s+/.test(s)) return false;
  if (isAwsRunningEvent(s)) return false;
  // READY is not considered running in the timeline. PAUSE, MANUAL,
  // EMERGENCY, NO COMMUNICATE, STOP, etc. all mean the turbine is not
  // visibly running unless there is an explicit Windturbine RUNNING interval.
  return true;
}

function collectAwsNonRunningStateIntervals(allRows) {
  return (allRows || [])
    .filter(row => row && isAwsNonRunningTurbineStateEvent(row.alarm))
    .map(row => ({
      startMin: Math.max(0, Number(row.startMin || 0)),
      endMin: Math.max(0, Number(row.endMin || row.startMin || 0)),
      alarm: String(row.alarm || '').trim()
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

function awsNonRunningStateAround(nonRunningStates, minute, lookAhead = 1.25, edge = 0.15) {
  const m = Math.max(0, Math.min(1440, Number(minute || 0)));
  return (nonRunningStates || []).find(st => {
    const s = Number(st.startMin || 0);
    const e = Math.max(s, Number(st.endMin || s));
    const overlapsBoundary = s <= (m + edge) && e >= (m - edge);
    const startsImmediatelyAfter = s > (m - edge) && s <= (m + lookAhead);
    return overlapsBoundary || startsImmediatelyAfter;
  }) || null;
}

function awsStateAtExactMinute(minute, runningIntervals, nonRunningStates, edge = (1 / 60)) {
  const m = Math.max(0, Math.min(1440, Number(minute || 0)));
  const nonRunning = (nonRunningStates || []).find(st => {
    const s = Number(st.startMin || 0);
    const e = Math.max(s, Number(st.endMin || s));
    return s <= (m + edge) && e >= (m - edge);
  }) || null;

  if (nonRunning) {
    return {
      running: false,
      state: nonRunning.alarm || 'Stopped',
      event: nonRunning.alarm || 'Stopped',
      eventStartMin: Number(nonRunning.startMin || m),
      eventEndMin: Number(nonRunning.endMin || nonRunning.startMin || m)
    };
  }

  const running = awsIntervalContainsMinute(runningIntervals, m, edge);
  return { running, state: running ? 'Running' : 'Stopped', event: running ? 'Windturbine RUNNING' : 'Stopped' };
}

function awsDisplayStateLabel(exactState) {
  if (!exactState) return 'Stopped';
  if (exactState.running) return 'Running';
  const event = String(exactState.event || exactState.state || '').trim();
  return event || 'Stopped';
}

function awsEnteredStateText(exactState, fallbackMinute, alarmStart, alarmEnd) {
  const label = awsDisplayStateLabel(exactState);
  const minute = Number.isFinite(Number(exactState && exactState.eventStartMin))
    ? Number(exactState.eventStartMin)
    : Number(fallbackMinute || alarmEnd || 0);
  if (label && label !== 'Stopped') {
    return 'entered ' + label + ' ' + awsRelativeAlarmMoment(minute, alarmStart, alarmEnd) + ' (' + awsHmsFromMin(minute) + ')';
  }
  return 'entered a stopped state ' + awsRelativeAlarmMoment(minute, alarmStart, alarmEnd) + ' (' + awsHmsFromMin(minute) + ')';
}

function splitAwsDatesByDay(start, end) {
  const out = [];
  let s = new Date(start.getTime());
  while (s < end) {
    const boundary = new Date(s.getFullYear(), s.getMonth(), s.getDate()+1, 0, 0, 0, 0);
    const e = end < boundary ? end : boundary;
    out.push({ s:new Date(s.getTime()), e:new Date(e.getTime()), sec:Math.max(0, (e.getTime() - s.getTime()) / 1000) });
    s = new Date(e.getTime());
  }
  return out;
}

function selectAwsDisplayDays(dayStats, startVal, endVal) {
  const keys = Object.keys(dayStats || {}).sort();
  if (!keys.length) return [];
  if (startVal && endVal) return keys.filter(k => k >= startVal && k <= endVal);
  return keys;
}

function awsYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function awsWeekdayName(key) {
  const d = new Date(key + 'T00:00:00');
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] || key;
}

function awsHms(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

function awsHmsFromMin(mins) {
  const numeric = Math.max(0, Math.min(1440, Number(mins || 0)));
  const totalSec = Math.round(numeric * 60);
  if (totalSec >= 86400) return '24:00:00';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function compactAwsDurationMinutes(mins) {
  const totalSec = Math.max(0, Math.round(Number(mins || 0) * 60));
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function mergeAwsMinuteIntervals(items) {
  if (!items.length) return [];
  const sorted = items.slice().sort((a,b)=>a.startMin-b.startMin || a.endMin-b.endMin);
  const out = [{startMin: sorted[0].startMin, endMin: sorted[0].endMin}];
  for (let i=1;i<sorted.length;i++) {
    const cur = sorted[i], last = out[out.length-1];
    if (cur.startMin <= last.endMin) last.endMin = Math.max(last.endMin, cur.endMin);
    else out.push({startMin: cur.startMin, endMin: cur.endMin});
  }
  return out;
}

function awsIntervalContainsMinute(intervals, minute, edge = 0.15) {
  return (intervals || []).some(seg => minute >= (seg.startMin - edge) && minute <= (seg.endMin + edge));
}

function awsIntervalSetOverlaps(intervals, startMin, endMin, edge = 0.15) {
  return (intervals || []).some(seg => (seg.startMin - edge) < endMin && (seg.endMin + edge) > startMin);
}

function findAwsContainingInterval(intervals, minute, edge = 0.15) {
  return (intervals || []).find(seg => minute >= (seg.startMin - edge) && minute <= (seg.endMin + edge)) || null;
}

function firstAwsRunningStartAfter(intervals, minute, edge = 0.15) {
  return (intervals || []).find(seg => seg.startMin > (minute + edge)) || null;
}

function formatAwsOffsetSeconds(sec) {
  const total = Math.max(0, Math.round(Number(sec || 0)));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) {
    if (m > 0 && s > 0) return `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`;
    if (m > 0) return `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
    if (s > 0) return `${h} hour${h === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  if (m > 0) return s > 0 ? `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`;
  return `${total} second${total === 1 ? '' : 's'}`;
}

function awsJoinWithAnd(parts) {
  const clean = (parts || []).filter(Boolean);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return clean[0] + ' and ' + clean[1];
  return clean.slice(0, -1).join(', ') + ', and ' + clean[clean.length - 1];
}

function awsRelativeAlarmMoment(minute, alarmStart, alarmEnd) {
  const diffFromStartSec = Math.round((minute - alarmStart) * 60);
  const diffFromEndSec = Math.round((minute - alarmEnd) * 60);
  if (Math.abs(diffFromStartSec) <= 1) return 'at alarm start';
  if (diffFromStartSec > 1 && minute <= alarmEnd + 0.15) return formatAwsOffsetSeconds(diffFromStartSec) + ' after alarm started';
  if (Math.abs(diffFromEndSec) <= 1) return 'at alarm end';
  if (diffFromEndSec > 1) return formatAwsOffsetSeconds(diffFromEndSec) + ' after alarm ended';
  if (diffFromEndSec < -1) return formatAwsOffsetSeconds(Math.abs(diffFromEndSec)) + ' before alarm ended';
  return 'around the alarm boundary';
}

function collectAwsAlarmTransitions(alarmStart, alarmEnd, runningIntervals, edge = 0.15) {
  const transitions = [];
  (runningIntervals || []).forEach(seg => {
    if (seg.startMin > (alarmStart + edge) && seg.startMin < (alarmEnd - edge)) transitions.push({ type:'start', minute: seg.startMin });
    if (seg.endMin > (alarmStart + edge) && seg.endMin < (alarmEnd - edge)) transitions.push({ type:'stop', minute: seg.endMin });
  });
  return transitions.sort((a,b) => a.minute - b.minute || (a.type === 'stop' ? 1 : -1));
}

function describeAwsTransitionList(transitions, alarmStart, alarmEnd) {
  return awsJoinWithAnd((transitions || []).map(t => {
    const action = t.type === 'start' ? 'started running' : 'stopped';
    return action + ' ' + awsRelativeAlarmMoment(t.minute, alarmStart, alarmEnd) + ' (' + awsHmsFromMin(t.minute) + ')';
  }));
}

function findAwsStoppingAlarmForRunningSeg(seg, allRows) {
  const safeEnd = Math.min(1440, Math.max(0, Number(seg && seg.endMin || 0)));
  const tolerance = 0.15;
  const lookAhead = 5;
  const alarmRows = (allRows || []).filter(row => row && row.alarm && !isAwsRunningEvent(row.alarm));
  if (!alarmRows.length) return null;
  const ranked = alarmRows.map(row => {
    const startMin = Math.max(0, Number(row.startMin || 0));
    const endMin = Math.max(startMin, Number(row.endMin || startMin));
    const activeAtStop = startMin <= (safeEnd + tolerance) && endMin >= (safeEnd - tolerance);
    const startsSoonAfter = startMin >= (safeEnd - tolerance) && startMin <= (safeEnd + lookAhead);
    const delta = activeAtStop ? Math.abs(startMin - safeEnd) : Math.max(0, startMin - safeEnd);
    let rank = 99;
    if (activeAtStop) rank = 0;
    else if (startsSoonAfter) rank = 1;
    return { rank, delta, row };
  }).filter(item => item.rank < 99)
    .sort((a,b) => a.rank - b.rank || a.delta - b.delta || a.row.startMin - b.row.startMin);
  if (!ranked.length) return null;
  const picked = ranked[0].row;
  return { alarm: String(picked.alarm || '').trim(), time: awsHms(picked.startDate) };
}

function getAwsActualEventEffect(seg, runningIntervals, allRows) {
  const safeStart = Math.max(0, Number(seg && seg.startMin || 0));
  const safeEndRaw = Math.max(safeStart, Number(seg && seg.endMin || safeStart));
  const safeEnd = Math.min(1440, safeEndRaw);
  const sample = 0.15;
  const stateSample = 1 / 60; // one second before/after the event boundary
  const exactStateEdge = 0.001; // do not let the target event bleed into before/after samples
  const beforeMinute = Math.max(0, safeStart - stateSample);
  const afterMinute = Math.min(1439.999, safeEnd + stateSample);
  const nonRunningStates = collectAwsNonRunningStateIntervals(allRows);
  const beforeExactState = awsStateAtExactMinute(beforeMinute, runningIntervals, nonRunningStates, exactStateEdge);
  const afterExactState = awsStateAtExactMinute(afterMinute, runningIntervals, nonRunningStates, exactStateEdge);
  const beforeNonRunningState = beforeExactState.running ? null : { startMin: beforeExactState.eventStartMin || beforeMinute, alarm: beforeExactState.event || 'Stopped' };
  const afterNonRunningState = afterExactState.running ? null : { startMin: afterExactState.eventStartMin || afterMinute, alarm: afterExactState.event || 'Stopped' };

  // The tooltip state is now sampled one second before alarm start and one
  // second after alarm end. This avoids saying "After: Running" when the
  // immediate next actual state is Windturbine PAUSE / READY / MANUAL.
  const beforeRunning = !!beforeExactState.running;
  const afterRunning = !!afterExactState.running;

  const overlapsRunning = awsIntervalSetOverlaps(runningIntervals, safeStart, safeEnd, sample);
  const overlapsNonRunning = (nonRunningStates || []).some(st => st.startMin < (safeEnd + sample) && st.endMin > (safeStart - sample));
  const runningAllEvent = !overlapsNonRunning && (runningIntervals || []).some(segRow => (segRow.startMin - sample) <= safeStart && (segRow.endMin + sample) >= safeEnd);
  const currentEventName = String(seg && seg.alarm || '').trim();
  const currentIsTurbineState = isAwsWindturbineStateEvent(currentEventName) && !isAwsRunningEvent(currentEventName);
  const beforeState = awsDisplayStateLabel(beforeExactState);
  const afterState = awsDisplayStateLabel(afterExactState);
  const duringState = currentIsTurbineState
    ? currentEventName
    : (runningAllEvent ? 'Running' : (overlapsRunning ? 'Partial running' : 'Stopped'));
  const transitionsInside = collectAwsAlarmTransitions(safeStart, safeEnd, runningIntervals, sample);
  const startContainer = findAwsContainingInterval(runningIntervals, safeStart, sample);
  const nextRunAfterAlarm = firstAwsRunningStartAfter(runningIntervals, safeEnd, sample);
  let resultLabel = '';
  let code = 'no_running';
  let stop = false;
  if (beforeRunning && afterRunning) {
    code = 'continues';
    if (currentIsTurbineState) {
      resultLabel = 'Turbine was running before the event, entered ' + currentEventName + ' during it, and returned to running after it ended.';
    } else if (runningAllEvent && !transitionsInside.length) resultLabel = 'Turbine was running at alarm start and kept running throughout the alarm until after it ended.';
    else {
      const transitionText = describeAwsTransitionList(transitionsInside, safeStart, safeEnd);
      resultLabel = 'Turbine was running at alarm start';
      if (transitionText) resultLabel += ', ' + transitionText;
      resultLabel += ', and it was running again after the alarm ended.';
    }
  } else if (beforeRunning && !afterRunning) {
    code = 'stops'; stop = true;
    const stopMinute = (startContainer && startContainer.endMin > (safeStart + sample) ? startContainer.endMin : null) || (afterNonRunningState ? afterNonRunningState.startMin : null) || (transitionsInside.find(t => t.type === 'stop') || {}).minute || safeEnd;
    const enteredState = awsEnteredStateText(afterExactState, stopMinute, safeStart, safeEnd);
    resultLabel = 'Turbine was running at alarm start, then ' + enteredState + ', and remained in that state after the alarm ended.';
  } else if (!beforeRunning && afterRunning) {
    code = 'starts_after';
    const firstStartInside = (transitionsInside.find(t => t.type === 'start') || {}).minute;
    if (firstStartInside != null) resultLabel = 'Turbine was stopped at alarm start, started running ' + awsRelativeAlarmMoment(firstStartInside, safeStart, safeEnd) + ' (' + awsHmsFromMin(firstStartInside) + '), and was still running after the alarm ended.';
    else if (nextRunAfterAlarm) resultLabel = 'Turbine stayed stopped during the alarm and started running ' + awsRelativeAlarmMoment(nextRunAfterAlarm.startMin, safeStart, safeEnd) + ' (' + awsHmsFromMin(nextRunAfterAlarm.startMin) + ').';
    else resultLabel = 'Turbine was stopped at alarm start and became running after the alarm.';
  } else if (overlapsRunning) {
    code = 'ends_within'; stop = true;
    const transitionText = describeAwsTransitionList(transitionsInside, safeStart, safeEnd);
    resultLabel = 'Turbine was stopped at alarm start';
    resultLabel += transitionText ? ', ' + transitionText : ', ran during part of the alarm';
    resultLabel += ', and was in ' + afterState + ' after the alarm ended.';
  } else {
    code = 'no_running';
    resultLabel = 'Turbine was in ' + beforeState + ' before the alarm, remained non-running during it, and was in ' + afterState + ' after it ended.';
  }
  return { resultLabel, stop, code, beforeState, duringState, afterState };
}


async function handleTurbineProfileAws(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const turbines = Array.isArray(payload.turbines) ? payload.turbines : [];
  const range = payload.range || {};
  if (!data.length) return json({ ok:true, profiles: [], metrics:{ rows:0, note:"No AWS rows received." } });
  if (!colMap.device || !colMap.category) {
    return json({ ok:false, error:"Missing AWS column map for Turbine Profile." }, 400);
  }

  const startFilter = range.startDate ? parseAwsFilterDate(range.startDate, range.startTime || '00:00') : null;
  const endFilter = range.endDate ? parseAwsFilterDate(range.endDate, range.endTime || '23:59') : null;
  const normalizedTurbines = Array.from(new Set(turbines.map(t => normalizeDeviceMatch(t)).filter(Boolean)));
  const profiles = normalizedTurbines.map(turbine => buildTurbineProfileAwsModel(data, colMap, turbine, startFilter, endFilter));
  return json({
    ok:true,
    backend:"cloudflare-worker",
    phase:"turbine-profile-aws-summary-recurrence",
    profiles,
    metrics:{ rows:data.length, turbines:profiles.length }
  });
}

function buildTurbineProfileAwsModel(data, colMap, turbine, startFilter, endFilter) {
  const target = normalizeDeviceMatch(turbine);
  const rows = [];
  for (const row of data) {
    const dev = validAwsDevice(row[colMap.device]);
    if (!dev || normalizeDeviceMatch(dev) !== target) continue;
    const dates = parseAwsRowDates(row, colMap);
    if (startFilter || endFilter) {
      if (!dates.start || !dates.end) continue;
      const clip = clipAwsDates(dates.start, dates.end, startFilter, endFilter);
      if (!clip.start || !clip.end) continue;
      rows.push({ row, dates, seconds: awsRowDurationSeconds(row, colMap, dates, startFilter, endFilter) });
    } else {
      rows.push({ row, dates, seconds: awsRowDurationSeconds(row, colMap, dates, null, null) });
    }
  }

  const summaryMap = new Map();
  let emergencyCount = 0;
  let warning903 = false;
  let totalSeconds = 0;

  for (const item of rows) {
    const row = item.row;
    const name = awsEventName(row, colMap) || '—';
    const cat = turbineProfileAwsCategory(row, colMap);
    const key = name + '||' + cat;
    if (!summaryMap.has(key)) summaryMap.set(key, { name, cat, count:0, seconds:0, lastMs:0 });
    const rec = summaryMap.get(key);
    rec.count += 1;
    rec.seconds += Math.max(0, Number(item.seconds || 0));
    totalSeconds += Math.max(0, Number(item.seconds || 0));
    if (item.dates && item.dates.start && item.dates.start.getTime() > rec.lastMs) rec.lastMs = item.dates.start.getTime();
    if (turbineProfileIsEmergency(row, colMap)) emergencyCount += 1;
    if (turbineProfileIsWarning903(row, colMap)) warning903 = true;
  }

  const alarmSummary = Array.from(summaryMap.values()).sort((a,b) => {
    return b.count - a.count || b.seconds - a.seconds || String(a.name).localeCompare(String(b.name), undefined, {numeric:true});
  }).map(r => ({
    name:r.name,
    cat:r.cat,
    count:r.count,
    seconds:r.seconds,
    durationText: formatSecondsDuration(r.seconds),
    lastMs:r.lastMs || 0,
    lastText:r.lastMs ? formatAwsDateTimeMinuteLocal(new Date(r.lastMs)) : '—'
  }));

  const recMap = new Map();
  for (const item of rows) {
    const row = item.row;
    const name = awsEventName(row, colMap) || '—';
    if (!recMap.has(name)) recMap.set(name, { name, count:0, days:new Set(), emergency:false, warning903:false });
    const rec = recMap.get(name);
    rec.count += 1;
    if (item.dates && item.dates.start) rec.days.add(awsYmd(item.dates.start));
    else rec.days.add('unknown');
    if (turbineProfileIsEmergency(row, colMap)) rec.emergency = true;
    if (turbineProfileIsWarning903(row, colMap)) rec.warning903 = true;
  }

  const recurrence = Array.from(recMap.values())
    .filter(r => r.count > 1 || r.days.size > 1 || r.emergency || r.warning903)
    .sort((a,b) => b.count - a.count || b.days.size - a.days.size || String(a.name).localeCompare(String(b.name), undefined, {numeric:true}))
    .map(r => ({ name:r.name, count:r.count, daysCount:r.days.size, emergency:r.emergency, warning903:r.warning903 }));

  const topAlarm = alarmSummary[0] || null;
  return {
    turbine: target,
    metrics:{
      awsEvents: rows.length,
      totalSeconds,
      totalDurationText: formatSecondsDuration(totalSeconds),
      topAlarmName: topAlarm ? topAlarm.name : '—',
      topAlarmCount: topAlarm ? topAlarm.count : 0,
      emergencyCount,
      warning903
    },
    alarmSummary,
    recurrence
  };
}

function turbineProfileAwsCategory(row, colMap) {
  if (!row || !colMap) return '—';
  const raw = colMap.category ? String(row[colMap.category] || '').trim() : '';
  return raw || '—';
}

function turbineProfileIsEmergency(row, colMap) {
  const txt = String(turbineProfileAwsCategory(row, colMap) + ' ' + awsEventName(row, colMap)).toLowerCase();
  return txt.includes('emergency');
}

function turbineProfileIsWarning903(row, colMap) {
  const txt = String(turbineProfileAwsCategory(row, colMap) + ' ' + awsEventName(row, colMap) + ' ' + Object.values(row || {}).join(' ')).toLowerCase();
  return txt.includes('warning') && /\b903\b/.test(txt);
}

function formatAwsDateTimeMinuteLocal(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '—';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mi}`;
}


async function handleAwsDetails(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  const eventName = String(payload.eventName || '').trim();
  const deviceName = String(payload.deviceName || '').trim();
  if (!data.length) return json({ ok:true, dayRows: [], hourRows: [], metrics:{ rows:0 } });
  if (!colMap.device || !colMap.category) {
    return json({ ok:false, error:"Missing AWS column map for device/category." }, 400);
  }
  if (!eventName || !deviceName) {
    return json({ ok:false, error:"Missing event name or turbine name for AWS details." }, 400);
  }
  const result = buildAwsDetailsModel(data, colMap, filters, eventName, deviceName);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-details-chart-prep", ...result });
}

function buildAwsDetailsModel(data, colMap, filters, eventName, deviceName) {
  const checkedCats = Array.isArray(filters.categories) ? filters.categories : [];
  const deviceFilterTerm = String(filters.deviceFilterTerm || '').trim().toLowerCase();
  const unifiedNone = !!filters.unifiedDeviceNoneMode;
  const unifiedSet = new Set((Array.isArray(filters.unifiedSelectedTurbines) ? filters.unifiedSelectedTurbines : []).map(v => normalizeDeviceMatch(v)).filter(Boolean));
  const startFilter = filters.startDate ? parseAwsFilterDate(filters.startDate, filters.startTime || '00:00') : null;
  const endFilter = filters.endDate ? parseAwsFilterDate(filters.endDate, filters.endTime || '23:59') : null;
  if (unifiedNone) return { dayRows: [], hourRows: [], metrics:{ rows:0, note:"No turbines selected." } };

  const dayBuckets = {};
  const hourRows = [];
  let sourceRows = 0;

  for (const row of data) {
    const categoryKey = awsCategoryKey(row, colMap);
    if (checkedCats.length && !checkedCats.includes(categoryKey)) continue;

    const evName = awsEventName(row, colMap);
    if (evName !== eventName) continue;

    const rawDev = row[colMap.device];
    if (rawDev == null) continue;
    const dev = String(rawDev).trim();
    if (dev !== deviceName) continue;
    if (!dev || dev.toLowerCase() === 'unknown' || dev === 'غير معروف') continue;
    if (deviceFilterTerm && !awsDeviceMatchesTerm(dev, deviceFilterTerm)) continue;
    if (unifiedSet.size && !unifiedSet.has(normalizeDeviceMatch(dev))) continue;

    const dates = parseAwsRowDates(row, colMap);
    if (!dates.start || !dates.end) continue;
    const clip = clipAwsDates(dates.start, dates.end, startFilter, endFilter);
    if (!clip.start || !clip.end) continue;
    sourceRows++;

    for (const seg of splitAwsDatesByDay(clip.start, clip.end)) {
      const key = awsYmd(seg.s);
      const dayStart = new Date(seg.s.getFullYear(), seg.s.getMonth(), seg.s.getDate(), 0, 0, 0, 0);
      if (!dayBuckets[key]) dayBuckets[key] = { start: dayStart, sec: 0, occ: 0, occurrencesMeta: [] };
      dayBuckets[key].occ += 1;
      dayBuckets[key].sec += seg.sec;
      dayBuckets[key].occurrencesMeta.push({ start: seg.s, end: seg.e, sec: seg.sec });
      hourRows.push({
        dayName: awsWeekdayName(key),
        date: key,
        start: seg.s.toISOString(),
        end: seg.e.toISOString(),
        startTime: awsHm(seg.s),
        endTime: awsHm(seg.e),
        sec: seg.sec,
        durationText: formatSecondsDuration(seg.sec)
      });
    }
  }

  const dayRows = Object.keys(dayBuckets).sort().map(key => {
    const r = dayBuckets[key];
    const metas = (r.occurrencesMeta || []).slice().sort((a,b)=>a.start-b.start);
    let firstOccStart = null;
    let lastOccEnd = null;
    for (const meta of metas) {
      if (!firstOccStart || meta.start < firstOccStart) firstOccStart = meta.start;
      if (!lastOccEnd || meta.end > lastOccEnd) lastOccEnd = meta.end;
    }
    return {
      dayName: awsWeekdayName(key),
      date: key,
      start: r.start.toISOString(),
      sec: r.sec,
      occ: r.occ,
      durationText: formatSecondsDuration(r.sec),
      firstOccStart: firstOccStart ? firstOccStart.toISOString() : null,
      lastOccEnd: lastOccEnd ? lastOccEnd.toISOString() : null,
      spanSec: (firstOccStart && lastOccEnd) ? Math.max(1, (lastOccEnd - firstOccStart) / 1000) : 0,
      occurrencesMeta: metas.map(m => ({ start:m.start.toISOString(), end:m.end.toISOString(), sec:m.sec }))
    };
  });

  hourRows.sort((a,b)=>String(a.start).localeCompare(String(b.start)));
  return {
    dayRows,
    hourRows,
    metrics: {
      rows: sourceRows,
      eventName,
      deviceName,
      days: dayRows.length,
      occurrences: dayRows.reduce((sum, r) => sum + Number(r.occ || 0), 0),
      durationText: formatSecondsDuration(dayRows.reduce((sum, r) => sum + Number(r.sec || 0), 0))
    }
  };
}

function awsHm(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

async function handleAwsSummary(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  if (!data.length) return json({ ok:true, rows: [], totals:{ occurrences:0, seconds:0, durationText:"00:00:00" } });
  if (!colMap.device || !colMap.category) {
    return json({ ok:false, error:"Missing AWS column map for device/category." }, 400);
  }
  const result = buildAwsSummaryRows(data, colMap, filters);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-summary-analysis", ...result });
}

function buildAwsSummaryRows(data, colMap, filters) {
  const checkedCats = Array.isArray(filters.categories) ? filters.categories : [];
  const selectedEvents = Array.isArray(filters.selectedEvents) ? filters.selectedEvents.filter(Boolean) : [];
  const allSelected = !!filters.allSelected || selectedEvents.includes('__ALL__') || selectedEvents.length === 0;
  const selectedSet = new Set(selectedEvents.filter(v => v !== '__ALL__'));
  const deviceFilterTerm = String(filters.deviceFilterTerm || '').trim().toLowerCase();
  const unifiedNone = !!filters.unifiedDeviceNoneMode;
  const unifiedSet = new Set((Array.isArray(filters.unifiedSelectedTurbines) ? filters.unifiedSelectedTurbines : []).map(v => normalizeDeviceMatch(v)).filter(Boolean));
  const startFilter = filters.startDate ? parseAwsFilterDate(filters.startDate, filters.startTime || '00:00') : null;
  const endFilter = filters.endDate ? parseAwsFilterDate(filters.endDate, filters.endTime || '23:59') : null;

  if (unifiedNone) return { rows: [], totals: { occurrences:0, seconds:0, durationText:"00:00:00" } };

  const perDevice = new Map();
  let totalOccurrences = 0;
  let totalSeconds = 0;

  for (const row of data) {
    const categoryKey = awsCategoryKey(row, colMap);
    if (checkedCats.length && !checkedCats.includes(categoryKey)) continue;

    const evName = awsEventName(row, colMap);
    if (!evName) continue;
    if (!allSelected && !selectedSet.has(evName)) continue;

    const rawDev = row[colMap.device];
    if (rawDev == null) continue;
    const device = String(rawDev).trim();
    if (!device || device.toLowerCase() === 'unknown' || device === 'غير معروف') continue;

    if (deviceFilterTerm && !awsDeviceMatchesTerm(device, deviceFilterTerm)) continue;
    if (unifiedSet.size && !unifiedSet.has(normalizeDeviceMatch(device))) continue;

    const dates = parseAwsRowDates(row, colMap);
    if (startFilter || endFilter) {
      if (!dates.start || !dates.end) continue;
      if (startFilter && dates.end < startFilter) continue;
      if (endFilter && dates.start > endFilter) continue;
    }

    const seconds = awsRowDurationSeconds(row, colMap, dates, startFilter, endFilter);
    totalOccurrences += 1;
    totalSeconds += seconds;
    const rec = perDevice.get(device) || { device, count:0, seconds:0 };
    rec.count += 1;
    rec.seconds += seconds;
    perDevice.set(device, rec);
  }

  const rows = Array.from(perDevice.values())
    .map(rec => ({
      device: rec.device,
      count: rec.count,
      seconds: rec.seconds,
      hours: rec.seconds / 3600,
      durationText: formatSecondsDuration(rec.seconds)
    }))
    .sort((a,b) => (b.seconds - a.seconds) || (b.count - a.count) || String(a.device).localeCompare(String(b.device), undefined, { numeric:true }));

  return {
    rows,
    totals: {
      occurrences: totalOccurrences,
      seconds: totalSeconds,
      hours: totalSeconds / 3600,
      durationText: formatSecondsDuration(totalSeconds)
    }
  };
}

async function handleAwsTable(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  if (!data.length) return json({ ok:true, rows: [], meta:{ rows:0 } });
  if (!colMap.device || !colMap.category) {
    return json({ ok:false, error:"Missing AWS column map for device/category." }, 400);
  }
  const rows = buildAwsTableRows(data, colMap, filters);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-table-analysis", rows, meta:{ rows:rows.length } });
}

function buildAwsTableRows(data, colMap, filters) {
  const checkedCats = Array.isArray(filters.categories) ? filters.categories : [];
  const selectedEvents = Array.isArray(filters.selectedEvents) ? filters.selectedEvents.filter(Boolean) : [];
  const allSelected = !!filters.allSelected || selectedEvents.includes('__ALL__') || selectedEvents.length === 0;
  const deviceFilterTerm = String(filters.deviceFilterTerm || '').trim().toLowerCase();
  const unifiedNone = !!filters.unifiedDeviceNoneMode;
  const unifiedSet = new Set((Array.isArray(filters.unifiedSelectedTurbines) ? filters.unifiedSelectedTurbines : []).map(v => normalizeDeviceMatch(v)).filter(Boolean));
  const startFilter = filters.startDate ? parseAwsFilterDate(filters.startDate, filters.startTime || '00:00') : null;
  const endFilter = filters.endDate ? parseAwsFilterDate(filters.endDate, filters.endTime || '23:59') : null;
  const sort = filters.sort || {};
  const useEvents = new Set(selectedEvents.filter(v => v !== '__ALL__'));

  if (unifiedNone) return [];

  const group = new Map();
  for (const row of data) {
    const categoryKey = awsCategoryKey(row, colMap);
    if (checkedCats.length && !checkedCats.includes(categoryKey)) continue;

    const evName = awsEventName(row, colMap);
    if (!evName) continue;
    if (!allSelected && !useEvents.has(evName)) continue;

    const rawDev = row[colMap.device];
    if (rawDev == null) continue;
    const dev = String(rawDev).trim();
    if (!dev || dev.toLowerCase() === 'unknown' || dev === 'غير معروف') continue;

    if (deviceFilterTerm && !awsDeviceMatchesTerm(dev, deviceFilterTerm)) continue;
    if (unifiedSet.size && !unifiedSet.has(normalizeDeviceMatch(dev))) continue;

    const dates = parseAwsRowDates(row, colMap);
    if (startFilter || endFilter) {
      if (!dates.start || !dates.end) continue;
      if (startFilter && dates.end < startFilter) continue;
      if (endFilter && dates.start > endFilter) continue;
    }

    const key = evName + '___' + dev;
    if (!group.has(key)) {
      group.set(key, { event: evName, device: dev, count: 0, duration: 0, earliest: null, latest: null, typeCounts: {} });
    }
    const g = group.get(key);
    g.count += 1;
    g.duration += awsRowDurationSeconds(row, colMap, dates, startFilter, endFilter);
    const t = awsRowType(row, colMap);
    g.typeCounts[t] = (g.typeCounts[t] || 0) + 1;

    if (dates.start && dates.end) {
      const clip = clipAwsDates(dates.start, dates.end, startFilter, endFilter);
      if (clip.start && clip.end) {
        if (!g.earliest || clip.start < g.earliest) g.earliest = clip.start;
        if (!g.latest || clip.end > g.latest) g.latest = clip.end;
      }
    }
  }

  const rows = Array.from(group.values()).map(g => {
    const type = dominantType(g.typeCounts);
    return {
      event: g.event,
      type,
      dateText: awsDateRangeText(g.earliest, g.latest),
      dateMs: g.earliest ? g.earliest.getTime() : 0,
      device: g.device,
      count: g.count,
      duration: g.duration,
      durationText: formatSecondsDuration(g.duration)
    };
  });

  sortAwsRows(rows, sort);
  return rows;
}

function parseAwsFilterDate(datePart, timePart) {
  const d = String(datePart || '').trim();
  if (!d) return null;
  const t = String(timePart || '').trim() || '00:00';
  return parseDateTimeFlexible(`${d} ${t}`) || parseDateTimeFlexible(`${d}T${t}`) || new Date(`${d}T${t}`);
}

function parseAwsRowDates(row, colMap) {
  const startRaw = colMap.start ? row[colMap.start] : '';
  const endRaw = colMap.end ? row[colMap.end] : '';
  const start = startRaw ? parseDateTimeFlexible(startRaw) : null;
  const end = endRaw ? parseDateTimeFlexible(endRaw) : null;
  return { start: start && !isNaN(start.getTime()) ? start : null, end: end && !isNaN(end.getTime()) ? end : null };
}

function awsRowDurationSeconds(row, colMap, dates, startFilter, endFilter) {
  if (dates && dates.start && dates.end) {
    if (startFilter || endFilter) return overlapSecondsDates(dates.start, dates.end, startFilter, endFilter);
    return Math.max(0, (dates.end.getTime() - dates.start.getTime()) / 1000);
  }
  if (colMap.duration && row[colMap.duration]) return parseAwsDurationSeconds(row[colMap.duration]);
  return 0;
}

function parseAwsDurationSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  let m = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const a = Number(m[1]) || 0;
    const b = Number(m[2]) || 0;
    const c = m[3] != null ? (Number(m[3]) || 0) : 0;
    return m[3] != null ? a * 3600 + b * 60 + c : a * 60 + b;
  }
  m = text.match(/([\d.]+)\s*(day|days|d|hour|hours|hr|hrs|h|min|mins|minute|minutes|m|sec|secs|second|seconds|s)/i);
  if (m) {
    const n = Number(m[1]) || 0;
    const u = m[2].toLowerCase();
    if (u === 'day' || u === 'days' || u === 'd') return n * 86400;
    if (u === 'hour' || u === 'hours' || u === 'hr' || u === 'hrs' || u === 'h') return n * 3600;
    if (u === 'min' || u === 'mins' || u === 'minute' || u === 'minutes' || u === 'm') return n * 60;
    return n;
  }
  const numeric = Number(text.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : 0;
}

function overlapSecondsDates(start, end, startFilter, endFilter) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  let s = start, e = end;
  if (startFilter && e < startFilter) return 0;
  if (endFilter && s > endFilter) return 0;
  if (startFilter && s < startFilter) s = startFilter;
  if (endFilter && e > endFilter) e = endFilter;
  return Math.max(0, (e.getTime() - s.getTime()) / 1000);
}

function clipAwsDates(start, end, startFilter, endFilter) {
  if (!(start instanceof Date) || !(end instanceof Date)) return { start:null, end:null };
  let s = start, e = end;
  if (startFilter && e < startFilter) return { start:null, end:null };
  if (endFilter && s > endFilter) return { start:null, end:null };
  if (startFilter && s < startFilter) s = startFilter;
  if (endFilter && e > endFilter) e = endFilter;
  if (e <= s) return { start:null, end:null };
  return { start:s, end:e };
}

function awsRowType(row, colMap) {
  const hasSub = colMap.subevent && String(row[colMap.subevent] || '').trim() !== '';
  if (hasSub) return 'Other';
  const raw = colMap.category ? String(row[colMap.category] || '').trim() : '';
  const lc = raw.toLowerCase();
  if (lc.includes('alarm') || raw === 'إنذار') return 'Alarm';
  if (lc.includes('state') || raw === 'حالة') return 'State';
  if (lc.includes('warning') || raw === 'تحذير') return 'Warning';
  return 'Other';
}

function dominantType(typeCounts) {
  let out = '';
  let max = 0;
  for (const [type, count] of Object.entries(typeCounts || {})) {
    if (count > max) { max = count; out = type; }
  }
  return out;
}

function awsDateRangeText(start, end) {
  if (!start) return '';
  if (end && start.toDateString() !== end.toDateString()) return `${formatAwsDateShort(start)} - ${formatAwsDateShort(end)}`;
  return formatAwsDateShort(start);
}

function formatAwsDateShort(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function formatSecondsDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const two = n => String(n).padStart(2, '0');
  return `${two(hours)}:${two(min)}:${two(sec)}`;
}

function awsDeviceMatchesTerm(device, term) {
  const devStr = String(device || '').trim().toLowerCase();
  const devDigits = devStr.replace(/\D/g, '');
  const filterDigits = String(term || '').replace(/\D/g, '');
  const containsText = devStr.includes(String(term || '').toLowerCase());
  const containsDigits = filterDigits ? devDigits.includes(filterDigits) : true;
  return containsText || containsDigits;
}

function normalizeDeviceMatch(value) {
  const s = String(value || '').toUpperCase().trim();
  const digits = s.replace(/\D/g, '');
  if (digits) return 'WTG' + digits.padStart(3, '0');
  return s;
}

function sortAwsRows(rows, sort) {
  const key = sort && sort.key;
  const dir = sort && sort.dir === 'asc' ? 'asc' : 'desc';
  const sign = dir === 'asc' ? 1 : -1;
  if (key) {
    rows.sort((a,b) => {
      let av = a[key], bv = b[key];
      if (key === 'date') { av = a.dateMs || 0; bv = b.dateMs || 0; }
      if (key === 'duration' || key === 'count' || key === 'date') return ((Number(av)||0) - (Number(bv)||0)) * sign;
      return String(av || '').localeCompare(String(bv || ''), undefined, { numeric:true }) * sign;
    });
  } else {
    rows.sort((a,b) => (b.count - a.count) || (b.duration - a.duration) || String(a.event).localeCompare(String(b.event), undefined, { numeric:true }));
  }
}

function parseCSVSmart(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sample = clean.slice(0, 4000);
  const delimiter = detectDelimiter(sample);
  let parsed = parseCSV(clean, delimiter);
  if (parsed.headers.length <= 1 && (clean.includes(";") || clean.includes(",") || clean.includes("\t"))) {
    const alternatives = [",", ";", "\t", "|"];
    for (const d of alternatives) {
      const candidate = parseCSV(clean, d);
      if (candidate.headers.length > parsed.headers.length) {
        parsed = candidate;
      }
    }
  }
  parsed.data = parsed.data.filter(r => Object.values(r).some(v => v !== null && String(v).trim() !== ""));
  return parsed;
}

function detectDelimiter(sample) {
  const candidates = [";", ",", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const count = (sample.match(new RegExp(escapeRegExp(d), "g")) || []).length;
    if (count > bestScore) { bestScore = count; best = d; }
  }
  return best;
}

function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function parseCSV(text, delimiter) {
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === "\n") { pushField(); pushRow(); i++; continue; }
    field += ch; i++;
  }
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) pushRow();

  const rawHeaders = rows.shift() || [];
  const headers = rawHeaders.map(h => String(h || "").trim());
  const data = rows.map(r => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = r[idx] === undefined ? "" : String(r[idx]).trim(); });
    return o;
  });
  return { headers, data, delimiter };
}

function autoMapColumns(cols) {
  const low = cols.map(c => String(c).toLowerCase());
  const find = (arr) => {
    for (const cand of arr) {
      const i = low.findIndex(h => h === cand || h.includes(cand));
      if (i !== -1) return cols[i];
    }
    return "";
  };
  return {
    device: find(["device", "wtg", "turbine", "turbine id", "turbine_id", "unit"]),
    alarm: find(["id event", "id_event", "alarm", "alarm id", "alarm_id", "event id", "event"]),
    desc: find(["description", "message", "text"]),
    time: find(["activated", "timestamp", "time", "date"]),
    status: find(["status", "state"])
  };
}

function mergeColumns(primary, fallback) {
  return {
    device: primary?.device || fallback?.device || "",
    alarm: primary?.alarm || fallback?.alarm || "",
    desc: primary?.desc || fallback?.desc || "",
    time: primary?.time || fallback?.time || "",
    status: primary?.status || fallback?.status || ""
  };
}

function normalizeValue(v) { return v == null ? "" : String(v).trim().toUpperCase(); }

function buildKey(row, cols, includeTime, normalize) {
  const d = row[cols.device], a = row[cols.alarm];
  if (d == null || a == null) return "";
  const dev = normalize ? normalizeValue(d) : String(d).trim();
  const alc = normalize ? normalizeValue(a) : String(a).trim();
  let key = dev + "||" + alc;
  if (includeTime && cols.time && row[cols.time]) {
    const t = normalize ? normalizeValue(row[cols.time]) : String(row[cols.time]).trim();
    key += "||" + t;
  }
  return key;
}

function indexBy(rows, cols, includeTime, normalize) {
  const m = new Map();
  for (const r of rows) {
    const k = buildKey(r, cols, includeTime, normalize);
    if (!k) continue;
    const obj = m.get(k) || { count: 0, row: r };
    obj.count += 1;
    m.set(k, obj);
  }
  return m;
}

function parseKey(k) {
  const [device, alarm, time] = String(k).split("||");
  return { device, alarm, time };
}

function groupResultsByAlarm(inputArray, hasCount = false) {
  const groupedMap = new Map();
  for (const row of inputArray) {
    const { alarm, device, description } = row;
    let entry = groupedMap.get(alarm);
    if (!entry) {
      entry = { alarm: alarm, description: description || "", devicesList: [] };
      groupedMap.set(alarm, entry);
    }
    entry.devicesList.push(device);
  }
  const outputArray = [];
  for (const entry of groupedMap.values()) {
    entry.devices = entry.devicesList.sort((a, b) => String(a).localeCompare(String(b), "ar")).join(", ");
    delete entry.devicesList;
    outputArray.push(entry);
  }
  return outputArray.sort((a, b) => String(a.alarm).localeCompare(String(b.alarm), "ar"));
}

function buildLubricationRowsFromToday(rowsToday, selToday) {
  const result = [];
  const descCol = selToday.desc;
  const timeCol = selToday.time;
  const now = new Date();
  for (const row of rowsToday) {
    const deviceVal = row[selToday.device] ?? "";
    const alarmVal = row[selToday.alarm] ?? "";
    const descVal = descCol ? (row[descCol] ?? "") : "";
    const textForSearch = [alarmVal, descVal].join(" ").toLowerCase();
    if (!textForSearch.includes("lubrication")) continue;
    const activationRaw = timeCol ? row[timeCol] : "";
    const activationStr = activationRaw == null ? "" : String(activationRaw).trim();
    let durationStr = "";
    let daysStr = "";
    let durHours = 0;
    if (activationStr) {
      const dt = parseDateTimeFlexible(activationStr);
      if (dt && !isNaN(dt.getTime())) {
        const diffMs = now - dt;
        if (diffMs >= 0) {
          durationStr = formatDuration(diffMs);
          const days = diffMs / (1000 * 60 * 60 * 24);
          daysStr = days.toFixed(2);
          durHours = diffMs / (1000 * 60 * 60);
        }
      }
    }
    result.push({
      device: String(deviceVal).trim(),
      alarm: String(alarmVal).trim(),
      activation: activationStr,
      duration: durationStr,
      days: daysStr,
      durationHours: durHours
    });
  }
  return result.sort((a, b) => {
    const bd = Number(b.days || 0);
    const ad = Number(a.days || 0);
    if (Number.isFinite(bd) && Number.isFinite(ad) && bd !== ad) return bd - ad;
    return String(a.device).localeCompare(String(b.device), undefined, { numeric: true });
  });
}

function parseDateTimeFlexible(value) {
  let text = String(value || "").trim();
  if (!text) return null;
  let d = new Date(text);
  if (!isNaN(d.getTime())) return d;
  let m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10) - 1;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    let hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = m[6] ? parseInt(m[6], 10) : 0;
    const ampm = m[7] ? m[7].toUpperCase() : "";
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return new Date(year, month, day, hour, min, sec);
  }
  m = text.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    let day = parseInt(m[1], 10);
    let month = monthNames.indexOf(m[2].toUpperCase());
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    let hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = m[6] ? parseInt(m[6], 10) : 0;
    const ampm = m[7] ? m[7].toUpperCase() : "";
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    if (month >= 0) return new Date(year, month, day, hour, min, sec);
  }
  return null;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const two = n => String(n).padStart(2, "0");
  return `${two(hours)}:${two(min)}:${two(sec)}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}


async function handleAwsLimitingEvents(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  const xmin = payload.xmin || {};
  const result = buildAwsLimitingEventsModel(data, colMap, filters, xmin);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-limiting-events", ...result });
}

async function handleAwsEmergencyPrealarms(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  const result = buildAwsEmergencyPrealarmsModel(data, colMap, filters);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-emergency-prealarms", ...result });
}

async function handleAwsPausePrealarms(request) {
  const payload = await request.json();
  const data = Array.isArray(payload.data) ? payload.data : [];
  const colMap = payload.colMap || {};
  const filters = payload.filters || {};
  const result = buildAwsPausePrealarmsModel(data, colMap, filters);
  return json({ ok:true, backend:"cloudflare-worker", phase:"aws-pause-prealarms", ...result });
}

function buildAwsLimitingEventsModel(data, colMap, filters, xmin) {
  const type = String(filters.type || 'all');
  const turbine = String(filters.turbine || '');
  const from = filters.from ? parseDateTimeFlexible(filters.from) : null;
  const to = filters.to ? parseDateTimeFlexible(filters.to) : null;
  const rowsRaw = Array.isArray(data) ? data : [];
  if (from && to && from > to) return { total:rowsRaw.length, rawMatches:0, rows:[], groups:{'17529':[],'17528':[]}, kpis:{}, error:'Start date/time is after end date/time.' };
  let rawMatches = 0;
  const rows = [];
  for (const item of rowsRaw) {
    const row = resolveAwsLimitRow(item, colMap);
    if (!row) continue;
    rawMatches += 1;
    if (type !== 'all' && row.code !== type) continue;
    if (!devicePassesExactFilter(row.device, turbine)) continue;
    if (!awsLimitOverlaps(row, from, to)) continue;
    row.clippedDuration = awsLimitClippedDuration(row, from, to);
    const ambient = row.code === '17528' ? backendXminMetricAt(xmin, row, 'temp') : null;
    const wind = row.code === '17528' ? backendXminMetricAt(xmin, row, 'wind') : null;
    row.ambientText = formatXminMetricText(ambient, '°C');
    row.windText = formatXminMetricText(wind, 'm/s');
    rows.push(row);
  }
  rows.sort((a,b) => ((a.start instanceof Date ? a.start.getTime() : 9e15) - (b.start instanceof Date ? b.start.getTime() : 9e15)) || String(a.device).localeCompare(String(b.device), undefined, {numeric:true}));
  const sortState = filters.sort || {};
  const groups = {
    '17529': summarizeAwsLimitingGroups(rows, '17529', sortState['17529']),
    '17528': summarizeAwsLimitingGroups(rows, '17528', sortState['17528'])
  };
  const devs = new Set(); let c17529 = 0, c17528 = 0, totalSeconds = 0;
  for (const r of rows) { devs.add(r.device); totalSeconds += Number(r.clippedDuration || 0); if (r.code === '17529') c17529 += 1; if (r.code === '17528') c17528 += 1; }
  return {
    total: rowsRaw.length,
    rawMatches,
    rows: rows.map(serializeLimitRow),
    groups,
    kpis: { occurrences:rows.length, turbines:devs.size, count17529:c17529, count17528:c17528, totalSeconds, durationText:formatSecondsDuration(totalSeconds), durationShort:formatShortDurationBackend(totalSeconds) }
  };
}

function resolveAwsLimitRow(item, colMap) {
  const raw = backendRawObject(item);
  const hay = [item && item.event, item && item.category, backendAllRowText(raw)].join(' | ');
  const kind = matchAwsLimitKind(hay);
  if (!kind) return null;
  let start = parseDateTimeFlexible(item && item.parsedStart) || parseDateTimeFlexible(item && item.startRaw);
  let end = parseDateTimeFlexible(item && item.parsedEnd) || parseDateTimeFlexible(item && item.endRaw);
  if (!start) start = parseDateTimeFlexible(findBackendValueByKey(raw, ['startdate','starttime','eventstart','begintime','begindate','occurrencetime','timestamp','datetime'], ['end','finish','clear']));
  if (!end) end = parseDateTimeFlexible(findBackendValueByKey(raw, ['enddate','endtime','finish','stoptime','cleartime','returntime'], ['start','begin']));
  if (!start) {
    const date = findBackendValueByKey(raw, ['date'], ['end']);
    const time = findBackendValueByKey(raw, ['time'], ['duration','end','clear','return']);
    start = parseDateTimeFlexible([date, time].filter(Boolean).join(' '));
  }
  const durRaw = (item && item.durationRaw) || findBackendValueByKey(raw, ['duration','totalduration'], []);
  const dur = parseAwsDurationSeconds(durRaw);
  if (start && !end && dur > 0) end = new Date(start.getTime() + dur * 1000);
  if (!end && start) end = start;
  const dev = String((item && item.device) || findBackendValueByKey(raw, ['device','wtg','turbine','plantunit','unit'], []) || 'Unknown').trim() || 'Unknown';
  return { device:dev, code:kind.code, short:kind.short, label:kind.label, category:(item && item.category) || findBackendValueByKey(raw, ['category','type','classification','categorization'], []), start, end, duration:dur, event:(item && item.event) || kind.label, rawText:backendAllRowText(raw) };
}

function matchAwsLimitKind(text) {
  const t = normalizeBackendText(text);
  if (/\b17529\b/.test(t) || (t.includes('limiting') && t.includes('component') && (t.includes('temperature') || t.includes('temp')))) return { code:'17529', short:'Component temperature', label:'17529 Limiting due to component temperature' };
  if (/\b17528\b/.test(t) || (t.includes('limiting') && (t.includes('derating') || t.includes('derat')))) return { code:'17528', short:'Derating', label:'17528 Limiting due to derating' };
  return null;
}

function awsLimitOverlaps(row, from, to) {
  if (!(row.start instanceof Date) || isNaN(row.start)) return !(from || to);
  const end = row.end instanceof Date && !isNaN(row.end) ? row.end : row.start;
  if (from && end < from) return false;
  if (to && row.start > to) return false;
  return true;
}

function awsLimitClippedDuration(row, from, to) {
  if (!(row.start instanceof Date) || isNaN(row.start)) return row.duration || 0;
  let s = row.start;
  let e = row.end instanceof Date && !isNaN(row.end) ? row.end : row.start;
  if (from && s < from) s = from;
  if (to && e > to) e = to;
  return Math.max(0, (e.getTime() - s.getTime()) / 1000) || row.duration || 0;
}

function summarizeAwsLimitingGroups(rows, code, sort) {
  const map = new Map();
  for (const r of rows) {
    if (r.code !== code) continue;
    const key = r.device || 'Unknown';
    if (!map.has(key)) map.set(key, { device:key, code, count:0, totalSeconds:0, details:[] });
    const g = map.get(key);
    g.count += 1;
    g.totalSeconds += Number(r.clippedDuration || 0);
    g.details.push(serializeLimitRow(r));
  }
  const list = Array.from(map.values()).map(g => ({ ...g, durationText:formatSecondsDuration(g.totalSeconds), durationShort:formatShortDurationBackend(g.totalSeconds) }));
  const st = sort || { key:'device', dir:'asc' };
  const dir = st.dir === 'desc' ? -1 : 1;
  list.sort((a,b) => {
    let av, bv;
    if (st.key === 'count') { av = a.count; bv = b.count; }
    else if (st.key === 'total') { av = a.totalSeconds; bv = b.totalSeconds; }
    else { av = normalizeDeviceNumber(a.device); bv = normalizeDeviceNumber(b.device); }
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir || String(a.device).localeCompare(String(b.device), undefined, {numeric:true});
    return String(av).localeCompare(String(bv), undefined, {numeric:true}) * dir;
  });
  return list;
}

function serializeLimitRow(r) {
  return { device:r.device || '', code:r.code || '', short:r.short || '', label:r.label || '', startText:formatDateTimeLocalBackend(r.start), endText:formatDateTimeLocalBackend(r.end), durationText:formatSecondsDuration(r.clippedDuration || r.duration || 0), durationShort:formatShortDurationBackend(r.clippedDuration || r.duration || 0), durationSeconds:Number(r.clippedDuration || r.duration || 0), category:r.category || '', event:r.event || r.label || '', ambientText:r.ambientText || '', windText:r.windText || '' };
}

function backendXminMetricAt(xmin, row, metric) {
  if (!xmin || !Array.isArray(xmin.rows) || !xmin.rows.length) return { missing:true, reason:'Upload X-Minutal file' };
  if (!(row.start instanceof Date) || isNaN(row.start)) return { missing:true, reason:'No valid AWS start time' };
  const dayKey = ymdBackend(row.start);
  const target = row.start.getHours() * 60 + row.start.getMinutes() + (row.start.getSeconds() || 0) / 60;
  const isTemp = metric === 'temp';
  if (isTemp && !xmin.tempVar) return { missing:true, reason:'Temp column missing' };
  if (!isTemp && !xmin.windVar) return { missing:true, reason:'Wind speed column missing' };
  let best = null;
  const byMinute = new Map();
  for (const xr of xmin.rows) {
    if (!xr || xr.dayKey !== dayKey || !devicesEqualLoose(xr.device, row.device)) continue;
    const rawVal = isTemp ? xr.tempValue : xr.windValue;
    const value = Number(rawVal);
    if (!Number.isFinite(value)) continue;
    const minute = Math.max(0, Math.min(1440, Math.round(Number(xr.minute))));
    const rec = byMinute.get(minute) || { minute, sum:0, count:0, labelTime:xr.labelTime || '' };
    rec.sum += value; rec.count += 1;
    byMinute.set(minute, rec);
  }
  for (const rec of byMinute.values()) {
    const diff = Math.abs(rec.minute - target);
    if (!best || diff < best.diff) best = { rec, diff };
  }
  if (!best) return { missing:true, reason:'No X-Minutal match' };
  if (best.diff > 15) return { missing:true, reason:'No close X-Minutal match' };
  return { value: best.rec.sum / Math.max(1, best.rec.count), labelTime: best.rec.labelTime || labelTimeFromMinuteBackend(best.rec.minute) };
}

function formatXminMetricText(hit, unit) {
  if (!hit) return '';
  if (hit.missing) return hit.reason || 'Missing';
  const value = Math.round(Number(hit.value || 0) * 10) / 10;
  return String(value.toFixed(1)).replace(/\.0$/, '') + ' ' + unit + ' @ ' + (hit.labelTime || '');
}

function buildAwsEmergencyPrealarmsModel(data, colMap, filters) {
  const rowsRaw = Array.isArray(data) ? data : [];
  const from = filters.from ? parseDateTimeFlexible(filters.from) : null;
  const to = filters.to ? parseDateTimeFlexible(filters.to) : null;
  const turbine = String(filters.turbine || '');
  const alarmQ = normalizeBackendText(filters.alarmSearch || '');
  const category = String(filters.category || 'both');
  const windowMin = Math.max(1, Number(filters.windowMin || 30) || 30);
  const windowMs = windowMin * 60 * 1000;
  const entries = [];
  rowsRaw.forEach((item, idx) => {
    const e = resolveAwsEmergencyEntry(item, idx, colMap);
    if (e) entries.push(e);
  });
  const excludedTurbines = buildBackendWarning903ExcludedTurbines(entries, { from, to, turbine, enabled: !!filters.exclude903 });
  const byDevice = new Map();
  for (const e of entries) { if (!byDevice.has(e.device)) byDevice.set(e.device, []); byDevice.get(e.device).push(e); }
  for (const arr of byDevice.values()) arr.sort((a,b) => a.start - b.start);
  const result = [];
  let emergenciesSeen = 0;
  for (const [dev, arr] of byDevice.entries()) {
    if (!devicePassesExactFilter(dev, turbine)) continue;
    if (excludedTurbines.has(dev)) continue;
    for (const em of arr) {
      if (!em.event || !isBackendEmergencyEntry(em)) continue;
      emergenciesSeen += 1;
      if (!dateInBackendRange(em.start, from, to)) continue;
      const fromTime = new Date(em.start.getTime() - windowMs);
      const matched = [];
      for (const pre of arr) {
        if (pre === em) continue;
        if (pre.type !== 'Alarm' && pre.type !== 'Warning') continue;
        if (category === 'alarm' && pre.type !== 'Alarm') continue;
        if (category === 'warning' && pre.type !== 'Warning') continue;
        // Strict lookback: only include events that START inside the selected window before the target event.
        // Long-running all-day alarms that started before the window are excluded.
        if (pre.start > em.start) continue;
        if (pre.start < fromTime) continue;
        if (alarmQ && !normalizeBackendText(pre.event).includes(alarmQ)) continue;
        matched.push(serializeEmergencyRow({ device:dev, emergencyName:em.event, emergencyStart:em.start, emergencyEnd:em.end, eventName:pre.event, eventType:pre.type, eventStart:pre.start, eventEnd:pre.end, preName:pre.event, preCat:pre.type, preStart:pre.start, preEnd:pre.end, deltaSec:Math.max(0, (em.start.getTime() - pre.start.getTime()) / 1000), rowKind:'pre' }));
      }
      result.push(...matched);
      if (!alarmQ || matched.length) {
        result.push(serializeEmergencyRow({ device:dev, emergencyName:em.event, emergencyStart:em.start, emergencyEnd:em.end, eventName:em.event, eventType:'Emergency', eventStart:em.start, eventEnd:em.end, preName:em.event, preCat:'Emergency', preStart:em.start, preEnd:em.end, deltaSec:0, rowKind:'emergency' }));
      }
    }
  }
  sortEmergencyRows(result, filters.sort || { key:'emergencyStart', dir:'asc' });
  const turbines = new Set(result.map(r => r.device));
  const incidents = new Set(result.map(r => r.device + '|' + r.emergencyStartText + '|' + r.emergencyName));
  const alarms = result.filter(r => r.preCat === 'Alarm').length;
  const warnings = result.filter(r => r.preCat === 'Warning').length;
  const emergencyRows = result.filter(r => r.preCat === 'Emergency').length;
  return { total:rowsRaw.length, rows:result, emergenciesSeen, windowMin, excludedTurbines:Array.from(excludedTurbines).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true})), excludedTurbinesCount:excludedTurbines.size, kpis:{ rows:result.length, turbines:turbines.size, incidents:incidents.size, alarms, warnings, emergencyRows } };
}


function buildAwsPausePrealarmsModel(data, colMap, filters) {
  const rowsRaw = Array.isArray(data) ? data : [];
  const from = filters.from ? parseDateTimeFlexible(filters.from) : null;
  const to = filters.to ? parseDateTimeFlexible(filters.to) : null;
  const turbine = String(filters.turbine || '');
  const alarmQ = normalizeBackendText(filters.alarmSearch || '');
  const category = String(filters.category || 'both');
  const windowMin = Math.max(1, Number(filters.windowMin || 30) || 30);
  const windowMs = windowMin * 60 * 1000;
  const entries = [];
  rowsRaw.forEach((item, idx) => {
    const e = resolveAwsEmergencyEntry(item, idx, colMap);
    if (e) entries.push(e);
  });
  const excludedTurbines = buildBackendWarning903ExcludedTurbines(entries, { from, to, turbine, enabled: !!filters.exclude903 });
  const byDevice = new Map();
  for (const e of entries) {
    if (!byDevice.has(e.device)) byDevice.set(e.device, []);
    byDevice.get(e.device).push(e);
  }
  for (const arr of byDevice.values()) arr.sort((a,b) => a.start - b.start);
  const result = [];
  let pauseSeen = 0;
  for (const [dev, arr] of byDevice.entries()) {
    if (!devicePassesExactFilter(dev, turbine)) continue;
    if (excludedTurbines.has(dev)) continue;
    for (const target of arr) {
      if (!target.event || !isBackendPauseEntry(target)) continue;
      pauseSeen += 1;
      if (!dateInBackendRange(target.start, from, to)) continue;
      const fromTime = new Date(target.start.getTime() - windowMs);
      const matched = [];
      for (const pre of arr) {
        if (pre === target) continue;
        if (pre.type !== 'Alarm' && pre.type !== 'Warning') continue;
        if (category === 'alarm' && pre.type !== 'Alarm') continue;
        if (category === 'warning' && pre.type !== 'Warning') continue;
        // Strict lookback: only include events that START inside the selected window before PAUSE.
        // Long-running all-day alarms that started before the window are excluded.
        if (pre.start > target.start) continue;
        if (pre.start < fromTime) continue;
        if (alarmQ && !normalizeBackendText(pre.event).includes(alarmQ)) continue;
        matched.push(serializeEmergencyRow({
          device:dev,
          emergencyName:target.event,
          emergencyStart:target.start,
          emergencyEnd:target.end,
          eventName:pre.event,
          eventType:pre.type,
          eventStart:pre.start,
          eventEnd:pre.end,
          preName:pre.event,
          preCat:pre.type,
          preStart:pre.start,
          preEnd:pre.end,
          deltaSec:Math.max(0, (target.start.getTime() - pre.start.getTime()) / 1000),
          rowKind:'pre'
        }));
      }
      result.push(...matched);
      if (!alarmQ || matched.length) {
        result.push(serializeEmergencyRow({
          device:dev,
          emergencyName:target.event,
          emergencyStart:target.start,
          emergencyEnd:target.end,
          eventName:target.event,
          eventType:'PAUSE',
          eventStart:target.start,
          eventEnd:target.end,
          preName:target.event,
          preCat:'PAUSE',
          preStart:target.start,
          preEnd:target.end,
          deltaSec:0,
          rowKind:'emergency'
        }));
      }
    }
  }
  sortEmergencyRows(result, filters.sort || { key:'emergencyStart', dir:'asc' });
  const turbines = new Set(result.map(r => r.device));
  const incidents = new Set(result.map(r => r.device + '|' + r.emergencyStartText + '|' + r.emergencyName));
  const alarms = result.filter(r => r.preCat === 'Alarm').length;
  const warnings = result.filter(r => r.preCat === 'Warning').length;
  const pauseRows = result.filter(r => r.preCat === 'PAUSE').length;
  return {
    total:rowsRaw.length,
    rows:result,
    pauseSeen,
    windowMin,
    excludedTurbines:Array.from(excludedTurbines).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true})),
    excludedTurbinesCount:excludedTurbines.size,
    kpis:{ rows:result.length, turbines:turbines.size, incidents:incidents.size, alarms, warnings, pauseRows }
  };
}

function resolveAwsEmergencyEntry(item, idx, colMap) {
  const raw = backendRawObject(item);
  let start = parseDateTimeFlexible(item && item.parsedStart) || parseDateTimeFlexible(item && item.startRaw);
  let end = parseDateTimeFlexible(item && item.parsedEnd) || parseDateTimeFlexible(item && item.endRaw);
  if (!start) start = parseDateTimeFlexible(findBackendValueByKey(raw, ['startdate','starttime','eventstart','begintime','begindate','occurrencetime','timestamp','datetime'], ['end','finish','clear']));
  if (!end) end = parseDateTimeFlexible(findBackendValueByKey(raw, ['enddate','endtime','finish','stoptime','cleartime','returntime'], ['start','begin']));
  if (!start) {
    const date = findBackendValueByKey(raw, ['date'], ['end']);
    const time = findBackendValueByKey(raw, ['time'], ['duration','end','clear','return']);
    start = parseDateTimeFlexible([date, time].filter(Boolean).join(' '));
  }
  if (!end && start) end = start;
  if (!start || !end) return null;
  const device = String((item && item.device) || findBackendValueByKey(raw, ['device','wtg','turbine','plantunit','unit'], []) || 'Unknown').trim() || 'Unknown';
  if (!device || device.toLowerCase() === 'unknown' || device === 'غير معروف') return null;
  const event = String((item && item.event) || findBackendValueByKey(raw, ['event','alarm','subevent','name','description'], []) || '').trim();
  const category = String((item && item.category) || findBackendValueByKey(raw, ['category','type','classification','categorization'], []) || '').trim();
  const subevent = String((item && item.subevent) || '').trim();
  return { idx, device, event, category, subevent, type:backendClassifyAwsEntry({ event, category, subevent, raw }), start, end, raw };
}

function backendClassifyAwsEntry(item) {
  const sub = String(item.subevent || '').trim();
  if (sub) return 'Other';
  const cat = normalizeBackendText(item.category || '');
  const ev = normalizeBackendText(item.event || '');
  if (cat.includes('alarm') || cat.includes('إنذار')) return 'Alarm';
  if (cat.includes('warning') || cat.includes('تحذير')) return 'Warning';
  if (cat.includes('state') || cat.includes('حالة')) return 'State';
  if (ev.includes('emergency') || ev.includes('pause')) return 'State';
  return 'Other';
}

function isBackendEmergencyEntry(item) {
  const text = normalizeBackendText((item.event || '') + ' ' + backendAllRowText(item.raw));
  return backendClassifyAwsEntry(item) === 'State' && text.includes('emergency');
}

function isBackendPauseEntry(item) {
  const text = normalizeBackendText((item.event || '') + ' ' + backendAllRowText(item.raw));
  return backendClassifyAwsEntry(item) === 'State' && text.includes('pause');
}

function isBackendWarning903Entry(item) {
  if (!item) return false;
  const type = String(item.type || backendClassifyAwsEntry(item) || '').toLowerCase();
  if (type !== 'warning') return false;
  const text = normalizeBackendText((item.event || '') + ' ' + (item.category || '') + ' ' + backendAllRowText(item.raw));
  return /\b903\b/.test(text) || (text.includes('903') && (text.includes('authoriz') || text.includes('person in turbine')));
}

function buildBackendWarning903ExcludedTurbines(entries, options) {
  const opts = options || {};
  const excluded = new Set();
  if (!opts.enabled) return excluded;
  const from = opts.from || null;
  const to = opts.to || null;
  const turbine = String(opts.turbine || '');
  for (const entry of entries || []) {
    if (!entry || !devicePassesExactFilter(entry.device, turbine)) continue;
    if (!dateInBackendRange(entry.start, from, to)) continue;
    if (isBackendWarning903Entry(entry)) excluded.add(entry.device);
  }
  return excluded;
}

function dateInBackendRange(d, from, to) {
  if (!(d instanceof Date) || isNaN(d)) return !(from || to);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function serializeEmergencyRow(r) {
  return { device:r.device || '', emergencyName:r.emergencyName || '', emergencyStart:r.emergencyStart instanceof Date ? r.emergencyStart.getTime() : 0, emergencyEnd:r.emergencyEnd instanceof Date ? r.emergencyEnd.getTime() : 0, emergencyStartText:formatDateTimeLocalBackend(r.emergencyStart), emergencyEndText:formatDateTimeLocalBackend(r.emergencyEnd), eventName:r.eventName || r.preName || '', eventType:r.eventType || r.preCat || '', eventStart:r.eventStart instanceof Date ? r.eventStart.getTime() : (r.preStart instanceof Date ? r.preStart.getTime() : 0), eventEnd:r.eventEnd instanceof Date ? r.eventEnd.getTime() : (r.preEnd instanceof Date ? r.preEnd.getTime() : 0), eventStartText:formatDateTimeLocalBackend(r.eventStart || r.preStart), eventEndText:formatDateTimeLocalBackend(r.eventEnd || r.preEnd), preName:r.preName || r.eventName || '', preCat:r.preCat || r.eventType || '', preStartText:formatDateTimeLocalBackend(r.preStart || r.eventStart), preEndText:formatDateTimeLocalBackend(r.preEnd || r.eventEnd), deltaSec:Number(r.deltaSec || 0), deltaText:formatSecondsDuration(r.deltaSec || 0), rowKind:r.rowKind || '' };
}

function sortEmergencyRows(rows, sort) {
  const key = sort && sort.key || 'emergencyStart';
  const dir = sort && sort.dir === 'desc' ? -1 : 1;
  rows.sort((a,b) => {
    let va = a[key], vb = b[key];
    if (key === 'emergencyStart') { va = a.emergencyStart; vb = b.emergencyStart; }
    if (key === 'emergencyEnd') { va = a.emergencyEnd; vb = b.emergencyEnd; }
    if (key === 'eventStart') { va = a.eventStart; vb = b.eventStart; }
    if (key === 'eventEnd') { va = a.eventEnd; vb = b.eventEnd; }
    let primary = 0;
    if (typeof va === 'number' && typeof vb === 'number') primary = (va - vb) * dir;
    else primary = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), undefined, {numeric:true, sensitivity:'base'}) * dir;
    if (primary) return primary;
    const ea = Number(a.emergencyStart || 0), eb = Number(b.emergencyStart || 0);
    if (ea !== eb) return ea - eb;
    const oa = a.rowKind === 'emergency' ? 1 : 0;
    const ob = b.rowKind === 'emergency' ? 1 : 0;
    if (oa !== ob) return oa - ob;
    return Number(a.eventStart || 0) - Number(b.eventStart || 0);
  });
}

function backendRawObject(item) {
  if (item && item.raw && typeof item.raw === 'object') return item.raw;
  if (item && typeof item === 'object') return item;
  return {};
}

function backendAllRowText(raw) {
  try { return Object.keys(raw || {}).map(k => String(k) + ': ' + String(raw[k] == null ? '' : raw[k])).join(' | '); } catch (_) { return ''; }
}

function findBackendValueByKey(raw, wants, rejects) {
  raw = raw || {}; rejects = rejects || [];
  const entries = Object.keys(raw).map(k => ({ key:k, nk:String(k).toLowerCase().replace(/[^a-z0-9]+/g,''), value:raw[k] }));
  for (const ent of entries) {
    if (ent.value == null || String(ent.value).trim() === '') continue;
    if (rejects.some(r => ent.nk.includes(r))) continue;
    if ((wants || []).some(w => ent.nk.includes(w))) return ent.value;
  }
  return '';
}

function normalizeBackendText(v) {
  return String(v == null ? '' : v).replace(/[\u200e\u200f]/g,'').replace(/\u00a0/g,' ').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').trim();
}

function normalizeBackendCompact(v) {
  return normalizeBackendText(v).replace(/\s+/g,'');
}

function backendDigits(v) { return String(v || '').replace(/\D/g,''); }

function normalizeDeviceNumber(v) {
  const d = backendDigits(v);
  return d ? Number(d) : String(v || '');
}

function normalizeDeviceExact(v) {
  const s = String(v || '').toUpperCase().trim();
  const d = backendDigits(s);
  if (d) return 'WTG' + d.padStart(3, '0');
  return s;
}

function devicePassesExactFilter(device, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;
  const deviceNorm = normalizeDeviceExact(device);
  const parts = raw.split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);
  if (!parts.length) return true;
  return parts.some(p => normalizeDeviceExact(p) === deviceNorm);
}

function devicesEqualLoose(a, b) {
  const na = normalizeBackendCompact(a), nb = normalizeBackendCompact(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const da = backendDigits(a), db = backendDigits(b);
  return !!(da && db && (da === db || da.includes(db) || db.includes(da)));
}

function ymdBackend(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatDateTimeLocalBackend(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

function formatShortDurationBackend(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60);
  if (d) return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
  if (h) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${m}m`;
}

function labelTimeFromMinuteBackend(minute) {
  const m = Math.max(0, Math.min(1440, Math.round(Number(minute) || 0)));
  const hh = Math.floor(m / 60), mm = m % 60;
  return String(Math.min(23, hh)).padStart(2,'0') + ':' + String(hh >= 24 ? 0 : mm).padStart(2,'0');
}


async function handleXminInspect(request) {
  const form = await request.formData();
  const file = form.get("xmin") || form.get("file") || form.get("xMinutal") || form.get("xMin");
  if (!file || typeof file.text !== "function") {
    return json({ ok:false, error:"Missing X-Minutal file" }, 400);
  }

  const text = await file.text();
  const parsed = parseCSVSmart(text);
  const headers = parsed.headers || [];
  const rows = parsed.data || [];
  const colMap = autoMapXminColumns(headers);
  const sampleRows = rows.slice(0, 5);
  const variableColumns = detectXminVariableColumns(headers, rows, colMap).slice(0, 80);

  return json({
    ok: true,
    backend: "cloudflare-worker",
    phase: "xmin-inspect",
    note: "Light X-Minutal backend phase: file parsing and column inspection only. Existing frontend calculations are unchanged.",
    stats: {
      rows: rows.length,
      columns: headers.length,
      variableColumns: variableColumns.length
    },
    columns: {
      header: headers,
      map: colMap,
      variableColumns
    },
    preview: sampleRows
  });
}


async function handleXminMetadata(request) {
  const form = await request.formData();
  const file = form.get("xmin") || form.get("file") || form.get("xMinutal") || form.get("xMin");
  if (!file || typeof file.text !== "function") {
    return json({ ok:false, error:"Missing X-Minutal file" }, 400);
  }

  const text = await file.text();
  const parsed = parseCSVSmart(text);
  const headers = parsed.headers || [];
  const rows = parsed.data || [];
  const colMap = autoMapXminColumns(headers);
  const variableColumns = detectXminVariableColumns(headers, rows, colMap);
  const metadata = buildXminMetadata(headers, rows, colMap, variableColumns);

  return json({
    ok: true,
    backend: "cloudflare-worker",
    phase: "xmin-metadata",
    note: "Light X-Minutal backend phase: metadata, turbine list, variable list, date range and validation only. Existing X-Minutal calculations are unchanged.",
    columns: {
      headers,
      map: colMap,
      variableColumns
    },
    metadata
  });
}

function buildXminMetadata(headers, rows, colMap, variableColumns) {
  const turbines = new Set();
  const variables = new Set();
  const dates = new Set();
  let firstTs = null;
  let lastTs = null;
  let validTimestampRows = 0;
  let numericValueRows = 0;

  const turbineCol = colMap && colMap.turbine;
  const variableCol = colMap && colMap.variable;
  const valueCol = colMap && colMap.value;

  for (const row of rows || []) {
    const turbine = turbineCol ? cleanCell(row[turbineCol]) : guessXminTurbineFromRow(row);
    if (turbine) turbines.add(normalizeXminTurbineLabel(turbine));

    const dt = parseXminRowTimestamp(row, colMap);
    if (dt) {
      validTimestampRows += 1;
      const ms = dt.getTime();
      if (firstTs === null || ms < firstTs) firstTs = ms;
      if (lastTs === null || ms > lastTs) lastTs = ms;
      dates.add(ymdBackend(dt));
    }

    if (variableCol) {
      const v = cleanCell(row[variableCol]);
      if (v) variables.add(v);
    }

    if (valueCol) {
      const n = Number(String(row[valueCol] ?? '').replace(/,/g, ''));
      if (Number.isFinite(n)) numericValueRows += 1;
    }
  }

  if (!variableCol) {
    for (const v of variableColumns || []) variables.add(v);
    numericValueRows = countRowsWithAnyNumericValue(rows, variableColumns);
  }

  const turbineList = Array.from(turbines).filter(Boolean).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric:true }));
  const variableList = Array.from(variables).filter(Boolean).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric:true }));
  const dateList = Array.from(dates).sort();

  const warnings = [];
  if (!rows.length) warnings.push('No data rows detected.');
  if (!turbineList.length) warnings.push('No turbine/WTG column or turbine-like values detected.');
  if (!validTimestampRows) warnings.push('No valid timestamp/date-time values detected.');
  if (!variableList.length) warnings.push('No variable/signal list detected.');
  if (!numericValueRows) warnings.push('No numeric value columns detected.');

  return {
    rowCount: rows.length,
    columnCount: (headers || []).length,
    turbineCount: turbineList.length,
    variableCount: variableList.length,
    dateCount: dateList.length,
    firstTimestamp: firstTs !== null ? formatDateTimeLocalBackend(new Date(firstTs)) : '',
    lastTimestamp: lastTs !== null ? formatDateTimeLocalBackend(new Date(lastTs)) : '',
    validTimestampRows,
    numericValueRows,
    turbines: turbineList,
    variables: variableList,
    dates: dateList,
    validation: {
      ok: warnings.length === 0,
      warnings
    },
    preview: {
      turbines: turbineList.slice(0, 50),
      variables: variableList.slice(0, 100),
      dates: dateList.slice(0, 20)
    }
  };
}


async function handleXminProfile(request) {
  const form = await request.formData();
  const file = form.get("xmin") || form.get("file") || form.get("xMinutal") || form.get("xMin");
  if (!file || typeof file.text !== "function") {
    return json({ ok:false, error:"Missing X-Minutal file" }, 400);
  }

  const text = await file.text();
  const parsed = parseCSVSmart(text);
  const headers = parsed.headers || [];
  const rows = parsed.data || [];
  const colMap = autoMapXminColumns(headers);
  const variableColumns = detectXminVariableColumns(headers, rows, colMap);
  const metadata = buildXminMetadata(headers, rows, colMap, variableColumns);
  const profile = buildXminFileProfile(headers, rows, colMap, variableColumns);

  return json({
    ok: true,
    backend: "cloudflare-worker",
    phase: "xmin-profile",
    note: "Light X-Minutal backend phase: validation, file profile, duplicate/bad-row scan and numeric-column statistics only. Existing X-Minutal calculations are unchanged.",
    columns: {
      headers,
      map: colMap,
      variableColumns
    },
    metadata,
    profile
  });
}



async function handleXminExceedanceSummary(request) {
  let payload = {};
  try { payload = await request.json(); } catch (_) { payload = {}; }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const variables = Array.isArray(payload.variables) ? payload.variables : [];
  const limit = Math.min(200000, Math.max(1, Number(payload.limit) || 200000));
  const details = buildXminExceedanceDetailsFromJsonRows(rows, variables, '', limit);
  const grouped = new Map();
  for (const r of details) {
    const device = cleanCell(r.device || '');
    if (!device) continue;
    let g = grouped.get(device);
    if (!g) { g = { device, count: 0 }; grouped.set(device, g); }
    g.count += 1;
  }
  const summaries = Array.from(grouped.values()).sort((a, b) => {
    const c = (b.count || 0) - (a.count || 0);
    if (c !== 0) return c;
    return String(a.device || '').localeCompare(String(b.device || ''), undefined, { numeric: true });
  });
  return json({
    ok: true,
    backend: 'cloudflare-worker',
    phase: 'xmin-exceedance-summary',
    note: 'X-Minutal Phase 6: Exceedances summary counts are prepared by backend. Frontend keeps the same UI and rendering.',
    rowsScanned: rows.length,
    variablesScanned: variables.length,
    totalExceedances: details.length,
    turbineCount: summaries.length,
    limited: details.length >= limit,
    summaries,
    detailRows: details
  });
}

async function handleXminExceedanceDetails(request) {
  let payload = {};
  try { payload = await request.json(); } catch (_) { payload = {}; }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const variables = Array.isArray(payload.variables) ? payload.variables : [];
  const device = cleanCell(payload.device || payload.turbine || '');
  const limit = Math.min(5000, Math.max(1, Number(payload.limit) || 5000));

  const details = buildXminExceedanceDetailsFromJsonRows(rows, variables, device, limit);
  return json({
    ok: true,
    backend: "cloudflare-worker",
    phase: "xmin-exceedance-details",
    note: "X-Minutal Phase 5: expanded Exceedances Details records are prepared by backend. Summary table and charts remain unchanged.",
    device,
    rowsScanned: rows.length,
    returnedRows: details.length,
    limited: details.length >= limit,
    details
  });
}

function buildXminExceedanceDetailsFromJsonRows(rows, variables, device, limit) {
  const wantedDevice = normalizeXminTurbineLabel(device);
  const keys = (variables || [])
    .map(v => ({ variable: cleanCell(v), limit: xminLimitForBackend(v) }))
    .filter(x => x.variable && x.limit != null);
  const out = [];
  for (const item of rows || []) {
    const row = item && item.row ? item.row : item;
    const dev = normalizeXminTurbineLabel((item && item.device) || (row && (row.Device || row.device || row.Turbine || row.turbine)) || '');
    if (wantedDevice && dev !== wantedDevice) continue;
    const date = cleanCell((row && (row.Date || row.date || row.Timestamp || row.timestamp)) || (item && item.date) || '');
    const ms = Number.isFinite(Number(item && item.ms)) ? Number(item.ms) : (parseXminFilterDateMs(date) ?? 0);
    for (const k of keys) {
      const val = toBackendNumber(row && row[k.variable]);
      if (Number.isFinite(val) && val > k.limit) {
        out.push({
          device: dev || wantedDevice,
          variable: k.variable,
          date,
          dateMs: ms,
          value: val,
          limit: k.limit,
          delta: val - k.limit
        });
        if (out.length >= limit) break;
      }
    }
    if (out.length >= limit) break;
  }
  out.sort((a,b) => (b.dateMs || 0) - (a.dateMs || 0));
  return out;
}

function xminLimitForBackend(name) {
  const n = String(name || '');
  const tests = [
    [/Bearing.*D\.?E\.?.*(?:temp|temperature).*10\s*M/i, 95],
    [/Bearing.*N\.?D\.?E\.?.*(?:temp|temperature).*10\s*M/i, 95],
    [/Gearbox.*bearing.*(?:temp|temperature).*10\s*M/i, 88],
    [/Gearbox.*oil.*(?:temp|temperature).*10\s*M/i, 75],
    [/Generator.*winding.*(?:temp|temperature).*1.*10\s*M/i, 150],
    [/Generator.*winding.*(?:temp|temperature).*2.*10\s*M/i, 150],
    [/Generator.*winding.*(?:temp|temperature).*3.*10\s*M/i, 150],
    [/Generator.*slip.*(?:temp|temperature).*10\s*M/i, 75],
    [/Trafo.*1.*winding.*(?:temp|temperature).*10\s*M/i, 140],
    [/Trafo.*2.*winding.*(?:temp|temperature).*10\s*M/i, 140],
    [/Trafo.*3.*winding.*(?:temp|temperature).*10\s*M/i, 140]
  ];
  for (const [re, lim] of tests) if (re.test(n)) return lim;
  return null;
}

async function handleXminDetailsPreview(request) {
  const form = await request.formData();
  const file = form.get("xmin") || form.get("file") || form.get("xMinutal") || form.get("xMin");
  if (!file || typeof file.text !== "function") {
    return json({ ok:false, error:"Missing X-Minutal file" }, 400);
  }

  let filters = {};
  try { filters = JSON.parse(String(form.get("filters") || "{}")); } catch (_) { filters = {}; }

  const text = await file.text();
  const parsed = parseCSVSmart(text);
  const headers = parsed.headers || [];
  const rows = parsed.data || [];
  const colMap = autoMapXminColumns(headers);
  const variableColumns = detectXminVariableColumns(headers, rows, colMap);
  const result = buildXminDetailsPreview(headers, rows, colMap, variableColumns, filters);

  return json({
    ok: true,
    backend: "cloudflare-worker",
    phase: "xmin-details-preview",
    note: "Light X-Minutal backend phase: filtered details preview only. Existing X-Minutal calculations, charts and filters are unchanged.",
    columns: {
      headers,
      map: colMap,
      variableColumns
    },
    result
  });
}

function buildXminDetailsPreview(headers, rows, colMap, variableColumns, filters) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const turbineNeedles = parseBackendListFilter(filters && (filters.turbines || filters.turbine || filters.turbineSearch));
  const variableNeedles = parseBackendListFilter(filters && (filters.variables || filters.variable || filters.variableSearch));
  const textNeedles = parseBackendListFilter(filters && (filters.search || filters.query || filters.text));
  const fromMs = parseXminFilterDateMs(filters && (filters.from || filters.fromDate || filters.start));
  const toMs = parseXminFilterDateMs(filters && (filters.to || filters.toDate || filters.end));
  const hardLimit = Math.min(1000, Math.max(20, Number(filters && filters.limit) || 250));

  const out = [];
  const turbineCol = colMap && colMap.turbine;
  const variableCol = colMap && colMap.variable;
  const valueCol = colMap && colMap.value;
  const wideMode = !variableCol && !valueCol;

  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i] || {};
    const dt = parseXminRowTimestamp(row, colMap);
    const ms = dt ? dt.getTime() : null;
    if (fromMs !== null && (ms === null || ms < fromMs)) continue;
    if (toMs !== null && (ms === null || ms > toMs)) continue;

    const turbine = normalizeXminTurbineLabel(turbineCol ? cleanCell(row[turbineCol]) : guessXminTurbineFromRow(row));
    if (turbineNeedles.length && !matchesXminTurbineFilter(turbine, turbineNeedles)) continue;

    if (!wideMode) {
      const variable = variableCol ? cleanCell(row[variableCol]) : '';
      if (variableNeedles.length && !matchesBackendTextAny(variable, variableNeedles)) continue;
      if (textNeedles.length && !matchesBackendTextAny(Object.values(row).join(' '), textNeedles)) continue;
      const raw = valueCol ? row[valueCol] : '';
      const n = toBackendNumber(raw);
      out.push({
        rowNumber: i + 2,
        turbine,
        timestamp: dt ? formatDateTimeLocalBackend(dt) : '',
        variable,
        value: Number.isFinite(n) ? n : cleanCell(raw),
        rawValue: cleanCell(raw)
      });
    } else {
      const wantedCols = variableNeedles.length
        ? (variableColumns || []).filter(v => matchesBackendTextAny(v, variableNeedles))
        : (variableColumns || []).slice(0, 80);
      if (textNeedles.length && !matchesBackendTextAny(Object.values(row).join(' '), textNeedles)) continue;
      for (const variable of wantedCols) {
        const raw = row[variable];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const n = toBackendNumber(raw);
        if (!Number.isFinite(n)) continue;
        out.push({
          rowNumber: i + 2,
          turbine,
          timestamp: dt ? formatDateTimeLocalBackend(dt) : '',
          variable,
          value: n,
          rawValue: cleanCell(raw)
        });
        if (out.length >= hardLimit) break;
      }
    }
    if (out.length >= hardLimit) break;
  }

  const turbines = Array.from(new Set(out.map(r => r.turbine).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true}));
  const variables = Array.from(new Set(out.map(r => r.variable).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true}));
  return {
    totalRowsScanned: safeRows.length,
    returnedRows: out.length,
    limited: out.length >= hardLimit,
    turbines,
    variables,
    rows: out
  };
}

function parseBackendListFilter(value) {
  if (Array.isArray(value)) return value.map(v => cleanCell(v)).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]+/)
    .map(v => cleanCell(v))
    .filter(Boolean);
}

function parseXminFilterDateMs(value) {
  if (!value) return null;
  const dt = parseDateTimeFlexible(value);
  return dt instanceof Date && !isNaN(dt.getTime()) ? dt.getTime() : null;
}

function matchesXminTurbineFilter(turbine, needles) {
  const t = normalizeXminTurbineLabel(turbine);
  return (needles || []).some(n => normalizeXminTurbineLabel(n) === t || normalizeBackendCompact(n) === normalizeBackendCompact(t));
}

function matchesBackendTextAny(text, needles) {
  const hay = normalizeBackendCompact(text);
  return (needles || []).some(n => hay.includes(normalizeBackendCompact(n)));
}

function toBackendNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function buildXminFileProfile(headers, rows, colMap, variableColumns) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const importantColumns = Array.from(new Set([
    colMap && colMap.turbine,
    colMap && colMap.date,
    colMap && colMap.time,
    colMap && colMap.timestamp,
    colMap && colMap.variable,
    colMap && colMap.value
  ].filter(Boolean)));

  const missingByImportantColumn = {};
  for (const col of importantColumns) missingByImportantColumn[col] = 0;

  let badTimestampRows = 0;
  let missingTurbineRows = 0;
  let rowsWithAnyNumeric = 0;
  let rowsWithoutNumeric = 0;
  let fullyEmptyRows = 0;
  const duplicateKeys = new Map();
  const sampleBadRows = [];

  const turbineCol = colMap && colMap.turbine;
  const variableCol = colMap && colMap.variable;
  const valueCol = colMap && colMap.value;
  const numericCols = (variableColumns || []).slice(0, 120);

  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i] || {};
    const values = safeHeaders.map(h => cleanCell(row[h]));
    if (values.every(v => !v)) fullyEmptyRows++;

    for (const col of importantColumns) {
      if (!cleanCell(row[col])) missingByImportantColumn[col]++;
    }

    const dt = parseXminRowTimestamp(row, colMap);
    if (!dt) {
      badTimestampRows++;
      if (sampleBadRows.length < 12) sampleBadRows.push({ rowNumber: i + 2, issue: 'Invalid timestamp/date-time', sample: compactXminSampleRow(row, safeHeaders) });
    }

    const turbine = turbineCol ? cleanCell(row[turbineCol]) : guessXminTurbineFromRow(row);
    if (!turbine) {
      missingTurbineRows++;
      if (sampleBadRows.length < 12) sampleBadRows.push({ rowNumber: i + 2, issue: 'Missing turbine/WTG value', sample: compactXminSampleRow(row, safeHeaders) });
    }

    let hasNumeric = false;
    if (valueCol) {
      const raw = row[valueCol];
      const n = Number(String(raw ?? '').replace(/,/g, ''));
      hasNumeric = raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isFinite(n);
    } else {
      for (const col of numericCols) {
        const raw = row[col];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const n = Number(String(raw).replace(/,/g, ''));
        if (Number.isFinite(n)) { hasNumeric = true; break; }
      }
    }
    if (hasNumeric) rowsWithAnyNumeric++; else rowsWithoutNumeric++;

    const keyParts = [];
    const tsText = dt ? formatDateTimeLocalBackend(dt) : '';
    keyParts.push(turbine || '');
    keyParts.push(tsText);
    if (variableCol) keyParts.push(cleanCell(row[variableCol]));
    if (valueCol) keyParts.push(cleanCell(row[valueCol]));
    if (!variableCol && !valueCol) keyParts.push(values.slice(0, 8).join('|'));
    const dupKey = keyParts.join('||');
    if (dupKey.replace(/[|]/g, '').trim()) duplicateKeys.set(dupKey, (duplicateKeys.get(dupKey) || 0) + 1);
  }

  let duplicateRowGroups = 0;
  let duplicateRows = 0;
  for (const count of duplicateKeys.values()) {
    if (count > 1) {
      duplicateRowGroups++;
      duplicateRows += count;
    }
  }

  const numericColumnStats = buildXminNumericColumnStats(safeRows, numericCols, valueCol, variableCol);
  const qualityScore = computeXminQualityScore({
    totalRows: safeRows.length,
    badTimestampRows,
    missingTurbineRows,
    rowsWithoutNumeric,
    duplicateRows,
    fullyEmptyRows
  });

  const warnings = [];
  if (!safeRows.length) warnings.push('No X-Minutal data rows detected.');
  if (badTimestampRows) warnings.push(`${badTimestampRows} row(s) have invalid or missing timestamp/date-time.`);
  if (missingTurbineRows) warnings.push(`${missingTurbineRows} row(s) have missing turbine/WTG values.`);
  if (rowsWithoutNumeric) warnings.push(`${rowsWithoutNumeric} row(s) do not contain a detected numeric value.`);
  if (duplicateRows) warnings.push(`${duplicateRows} row(s) appear in ${duplicateRowGroups} duplicate group(s).`);
  if (fullyEmptyRows) warnings.push(`${fullyEmptyRows} fully empty row(s) detected.`);
  if (!numericColumnStats.length) warnings.push('No numeric variable columns could be profiled.');

  return {
    validation: {
      ok: warnings.length === 0,
      qualityScore,
      warnings
    },
    counts: {
      rows: safeRows.length,
      columns: safeHeaders.length,
      importantColumns: importantColumns.length,
      numericProfiledColumns: numericColumnStats.length,
      badTimestampRows,
      missingTurbineRows,
      rowsWithAnyNumeric,
      rowsWithoutNumeric,
      fullyEmptyRows,
      duplicateRowGroups,
      duplicateRows
    },
    missingByImportantColumn,
    numericColumnStats,
    sampleBadRows
  };
}

function buildXminNumericColumnStats(rows, numericCols, valueCol, variableCol) {
  if (!Array.isArray(rows) || !rows.length) return [];
  if (valueCol && variableCol) {
    const byVar = new Map();
    for (const row of rows) {
      const name = cleanCell(row[variableCol]) || '(blank variable)';
      const raw = row[valueCol];
      const text = String(raw ?? '').trim();
      if (!byVar.has(name)) byVar.set(name, makeStatBucket(name));
      const bucket = byVar.get(name);
      bucket.total++;
      if (!text) { bucket.missing++; continue; }
      const n = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(n)) { bucket.nonNumeric++; continue; }
      pushStatNumber(bucket, n);
    }
    return Array.from(byVar.values()).map(finalizeStatBucket).sort((a,b) => b.numericCount - a.numericCount).slice(0, 80);
  }

  const out = [];
  for (const col of (numericCols || []).slice(0, 120)) {
    const bucket = makeStatBucket(col);
    for (const row of rows) {
      const text = String(row[col] ?? '').trim();
      bucket.total++;
      if (!text) { bucket.missing++; continue; }
      const n = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(n)) { bucket.nonNumeric++; continue; }
      pushStatNumber(bucket, n);
    }
    out.push(finalizeStatBucket(bucket));
  }
  return out.sort((a,b) => b.numericCount - a.numericCount).slice(0, 80);
}

function makeStatBucket(name) {
  return { name, total: 0, missing: 0, nonNumeric: 0, numericCount: 0, min: null, max: null, sum: 0 };
}

function pushStatNumber(bucket, n) {
  bucket.numericCount++;
  bucket.sum += n;
  if (bucket.min === null || n < bucket.min) bucket.min = n;
  if (bucket.max === null || n > bucket.max) bucket.max = n;
}

function finalizeStatBucket(bucket) {
  const avg = bucket.numericCount ? bucket.sum / bucket.numericCount : null;
  return {
    name: bucket.name,
    total: bucket.total,
    numericCount: bucket.numericCount,
    missing: bucket.missing,
    nonNumeric: bucket.nonNumeric,
    min: bucket.min,
    max: bucket.max,
    average: avg === null ? null : Number(avg.toFixed(4)),
    numericRatio: bucket.total ? Number((bucket.numericCount / bucket.total).toFixed(4)) : 0
  };
}

function compactXminSampleRow(row, headers) {
  const out = {};
  for (const h of (headers || []).slice(0, 8)) {
    const v = cleanCell(row[h]);
    if (v) out[h] = v.length > 80 ? v.slice(0, 77) + '...' : v;
  }
  return out;
}

function computeXminQualityScore(info) {
  const total = Math.max(1, Number(info.totalRows || 0));
  let penalty = 0;
  penalty += Math.min(35, (Number(info.badTimestampRows || 0) / total) * 35);
  penalty += Math.min(25, (Number(info.missingTurbineRows || 0) / total) * 25);
  penalty += Math.min(20, (Number(info.rowsWithoutNumeric || 0) / total) * 20);
  penalty += Math.min(10, (Number(info.duplicateRows || 0) / total) * 10);
  penalty += Math.min(10, (Number(info.fullyEmptyRows || 0) / total) * 10);
  return Math.max(0, Math.round(100 - penalty));
}

function parseXminRowTimestamp(row, colMap) {
  if (!row || !colMap) return null;
  const directCol = colMap.timestamp || colMap.time;
  const dateCol = colMap.date;
  const timeCol = colMap.time;

  const candidates = [];
  if (directCol && row[directCol] !== undefined) candidates.push(row[directCol]);
  if (dateCol && timeCol && dateCol !== timeCol) candidates.push(`${row[dateCol] || ''} ${row[timeCol] || ''}`.trim());
  if (dateCol && row[dateCol] !== undefined) candidates.push(row[dateCol]);

  for (const c of candidates) {
    const dt = parseDateTimeFlexible(c);
    if (dt instanceof Date && !isNaN(dt.getTime())) return dt;
  }
  return null;
}

function countRowsWithAnyNumericValue(rows, variableColumns) {
  if (!Array.isArray(rows) || !Array.isArray(variableColumns) || !variableColumns.length) return 0;
  let count = 0;
  for (const row of rows) {
    let has = false;
    for (const col of variableColumns) {
      const raw = row[col];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const n = Number(String(raw).replace(/,/g, ''));
      if (Number.isFinite(n)) { has = true; break; }
    }
    if (has) count++;
  }
  return count;
}

function guessXminTurbineFromRow(row) {
  const vals = Object.values(row || {}).map(cleanCell);
  return vals.find(v => /\bWTG\s*0*\d+\b/i.test(v) || /\bturbine\s*0*\d+\b/i.test(v)) || '';
}

function normalizeXminTurbineLabel(value) {
  const text = cleanCell(value).toUpperCase().replace(/\s+/g, '');
  const m = text.match(/WTG0*(\d+)/i) || text.match(/TURBINE0*(\d+)/i);
  if (m) return 'WTG' + String(Number(m[1])).padStart(3, '0');
  const n = text.match(/^0*(\d{1,3})$/);
  if (n) return 'WTG' + String(Number(n[1])).padStart(3, '0');
  return text;
}

function autoMapXminColumns(headers) {
  const norm = (v) => String(v || "").toLowerCase().replace(/[\s_\-./\\]+/g, "").trim();
  const hs = (headers || []).map(h => ({ original: h, n: norm(h) }));
  const find = (candidates, reject) => {
    for (const c of candidates) {
      const cn = norm(c);
      const exact = hs.find(h => h.n === cn && !(reject || []).some(r => h.n.includes(norm(r))));
      if (exact) return exact.original;
    }
    for (const c of candidates) {
      const cn = norm(c);
      const partial = hs.find(h => (h.n.includes(cn) || cn.includes(h.n)) && !(reject || []).some(r => h.n.includes(norm(r))));
      if (partial) return partial.original;
    }
    return "";
  };

  const turbine = find(["turbine", "wtg", "device", "asset", "tag", "unit", "plantunit", "object"]);
  const date = find(["date", "day"]);
  const time = find(["time", "timestamp", "datetime", "date time", "sample time", "record time"]);
  const timestamp = find(["timestamp", "datetime", "date time", "sample time", "record time"]);
  const variable = find(["variable", "signal", "measurement", "parameter", "point", "tagname", "name"], ["value"]);
  const value = find(["value", "reading", "avg", "average", "mean", "actual", "data"], ["date", "time"]);

  return { turbine, date, time, timestamp, variable, value };
}

function detectXminVariableColumns(headers, rows, colMap) {
  const reserved = new Set(Object.values(colMap || {}).filter(Boolean));
  const sample = (rows || []).slice(0, 30);
  const out = [];
  for (const h of headers || []) {
    if (reserved.has(h)) continue;
    let numeric = 0;
    let filled = 0;
    for (const r of sample) {
      const raw = r[h];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      filled++;
      const n = Number(String(raw).replace(/,/g, ""));
      if (Number.isFinite(n)) numeric++;
    }
    if (filled && numeric / filled >= 0.7) out.push(h);
  }
  return out;
}
