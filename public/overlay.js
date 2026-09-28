/* ==========================================================================
   CRICKET LIVE STUDIO v36 — overlay engine
   Reads /api/state (normalized by server.js) once per second and renders
   two layouts from the same data:  ?layout=studio (default)  |  ?layout=bar
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------- config ---------------- */
  const params = new URLSearchParams(location.search);
  const key = params.get('key') || '11AI';
  const demo = params.get('demo') === '1';
  let demoScene = (params.get('scene') || 'live').toLowerCase();
  const autoplay = params.get('autoplay') !== '0';
  const POLL_MS = Math.max(500, Number(params.get('poll')) || 1000);
  const TAKEOVER_MS = Math.max(1200, Number(params.get('stinger')) || 2400);
  const stingersOn = params.get('stingers') !== '0';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || params.get('motion') === '0';

  const body = document.body;
  const stage = document.getElementById('stage');
  const $ = id => document.getElementById(id);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function setLayout(layout) {
    const l = String(layout || 'studio').toLowerCase();
    body.classList.toggle('layout-bar', l === 'bar' || l === 'lower' || l === 'lowerthird');
    body.classList.toggle('layout-studio', !body.classList.contains('layout-bar'));
  }
  setLayout(params.get('layout'));
  if (['none', 'transparent', '0', 'off'].includes(String(params.get('bg') || '').toLowerCase())) body.classList.add('bg-none');
  if (reducedMotion) body.classList.add('no-motion');

  /* ---------------- stage scaling ---------------- */
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--scale', String(s || 1));
  }
  window.addEventListener('resize', fit); fit();

  /* ---------------- tiny DOM binding layer ---------------- */
  function bind(name, value, { flash = false } = {}) {
    const next = String(value ?? '—');
    for (const el of document.querySelectorAll(`[data-bind="${name}"]`)) {
      if (el.textContent === next) continue;
      el.textContent = next;
      if (flash) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
    }
  }

  function rollInto(el, next) {
    const prev = el.dataset.v;
    if (prev === next) return;
    el.dataset.v = next;
    const animate = !(prev === undefined || reducedMotion || prev === '' || prev === '—' || next === '—');
    const a = [...next], b = [...(prev || '')];
    const pad = a.length - b.length;
    const frag = document.createDocumentFragment();
    a.forEach((ch, i) => {
      const old = b[i - pad];
      const span = document.createElement('span');
      span.className = /[\/\-–]/.test(ch) ? 'ch sep' : 'ch';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = ch;
      span.appendChild(n);
      if (animate && old !== ch) {
        span.classList.add('go');
        if (old !== undefined) { const o = document.createElement('span'); o.className = 'o'; o.textContent = old; span.appendChild(o); }
        n.style.animationDelay = `${(a.length - i) * 22}ms`;
      }
      frag.appendChild(span);
    });
    el.textContent = '';
    el.appendChild(frag);
    if (animate) setTimeout(() => { if (el.dataset.v === next) el.querySelectorAll('.o').forEach(o => o.remove()); }, 900);
  }
  function roll(name, value) {
    const next = String(value ?? '—');
    for (const el of document.querySelectorAll(`[data-roll="${name}"]`)) rollInto(el, next);
  }

  function meter(name, fraction) {
    const v = Math.max(0, Math.min(1, Number(fraction) || 0));
    for (const el of document.querySelectorAll(`[data-meter="${name}"]`)) el.style.setProperty('--v', v.toFixed(4));
  }

  function restartClass(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* ---------------- teams ---------------- */
  function teamInfo(name) {
    const p = window.findCricketTeamPreset?.(name);
    if (p) return p;
    const code = String(name || 'TEAM').split(/\s+/).map(x => x[0]).join('').slice(0, 3).toUpperCase();
    return { name: name || 'Team', code: code || 'TM', primary: '#3b4a6b', secondary: '#7c8db5' };
  }
  const markCache = {};
  let markUid = 0;
  function setMark(slot, name, fallbackStar = false) {
    const sig = fallbackStar ? '__star' : String(name || '');
    if (markCache[slot] === sig) return;
    markCache[slot] = sig;
    const html = fallbackStar
      ? '<span class="winner-star"><svg viewBox="0 0 64 64"><use href="#i-trophy"/></svg></span>'
      : (window.teamMarkSvg ? window.teamMarkSvg(teamInfo(name)) : `<b>${teamInfo(name).code}</b>`);
    // each copy needs unique SVG ids, otherwise a clipPath inside a hidden layout breaks the visible one
    for (const el of document.querySelectorAll(`[data-mark="${slot}"]`)) { const u = ++markUid; el.innerHTML = html.replace(/(id="|url\(#)(clip|sh)-/g, `$1$2-u${u}-`); }
  }
  function hexToRgb(hex) {
    const c = String(hex || '').replace('#', '').trim();
    if (/^[0-9a-f]{3}$/i.test(c)) return c.split('').map(x => parseInt(x + x, 16));
    if (/^[0-9a-f]{6}$/i.test(c)) return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
    return [59, 74, 107];
  }
  // keep very light team colours (e.g. England white) readable as glows on dark UI
  function glowSafe(hex) {
    const [r, g, b] = hexToRgb(hex);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.85 ? '#8a9bc4' : hex;
  }
  function setColors(batting, bowling) {
    const h = teamInfo(batting), a = teamInfo(bowling), s = document.documentElement.style;
    s.setProperty('--home', glowSafe(h.primary)); s.setProperty('--home2', glowSafe(h.secondary));
    s.setProperty('--away', glowSafe(a.primary)); s.setProperty('--away2', glowSafe(a.secondary));
    return { h, a };
  }
  function applyWinnerTheme(name) {
    const w = teamInfo(name), s = document.documentElement.style;
    s.setProperty('--winner', glowSafe(w.primary)); s.setProperty('--winner2', glowSafe(w.secondary));
    return w;
  }

  /* ---------------- time helpers (ported from v35) ---------------- */
  function isValidTimeZone(tz) { if (!tz) return false; try { Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); return true; } catch { return false; } }
  function resolveDisplayTimeZone(raw = '') {
    const forced = params.get('tz') || params.get('timezone') || '';
    const candidate = String(forced || raw || '').trim();
    if (isValidTimeZone(candidate)) return candidate;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }
  function formatInTimeZone(date, timeZone = '') {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const opt = { hour: 'numeric', minute: '2-digit' };
    if (isValidTimeZone(timeZone)) opt.timeZone = timeZone;
    return date.toLocaleTimeString([], opt).replace(/\s+/g, ' ').toUpperCase();
  }
  function timeZoneLabel(timeZone = '', date = new Date()) {
    if (!timeZone) return 'LOCAL TIME';
    if (/^[+-]\d{2}:?\d{2}$/.test(timeZone)) return `UTC${timeZone.replace(/^(..)(..)$/, '$1:$2')}`;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
      return String(parts.find(p => p.type === 'timeZoneName')?.value || timeZone).toUpperCase();
    } catch { return String(timeZone).toUpperCase(); }
  }
  function zonedDateToUtc(datePart, timePart, timeZone) {
    const m = String(datePart || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const t = String(timePart || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m || !t || !isValidTimeZone(timeZone)) return null;
    const utcGuess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], +(t[3] || 0)));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(utcGuess).reduce((acc, p) => { if (p.type !== 'literal') acc[p.type] = p.value; return acc; }, {});
    const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return new Date(utcGuess.getTime() - (asIfUtc - utcGuess.getTime()));
  }
  function formatClock(raw, dateRaw = '') {
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    const original = String(raw).trim(), number = Number(original);
    const fmt = d => (d instanceof Date && !Number.isNaN(d.getTime())) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toUpperCase() : '';
    if (Number.isFinite(number) && number > 1e9) { const out = fmt(new Date(number < 1e12 ? number * 1000 : number)); if (out) return out; }
    const clock = original.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (clock) {
      let hour = +clock[1]; const minute = +clock[2]; const mer = clock[3]?.toUpperCase();
      if (mer === 'PM' && hour < 12) hour += 12; if (mer === 'AM' && hour === 12) hour = 0;
      return fmt(new Date(2000, 0, 1, hour, minute)) || original.toUpperCase();
    }
    const combined = dateRaw && !/[T\s]\d{1,2}:\d{2}/.test(original) ? `${dateRaw} ${original}` : original;
    if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}|T\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(combined)) { const out = fmt(new Date(combined)); if (out) return out; }
    return original.length <= 12 ? original.toUpperCase() : '';
  }
  function parseMatchStart(raw, dateRaw = '', sourceTz = '') {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const original = String(raw).trim(), number = Number(original);
    if (Number.isFinite(number) && number > 1e9) { const d = new Date(number < 1e12 ? number * 1000 : number); return Number.isNaN(d.getTime()) ? null : d; }
    const offset = String(sourceTz || '').trim();
    const clock = original.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (clock && dateRaw) {
      let hour = +clock[1]; const minute = +clock[2], second = +(clock[3] || 0); const mer = clock[4]?.toUpperCase();
      if (mer === 'PM' && hour < 12) hour += 12; if (mer === 'AM' && hour === 12) hour = 0;
      const timePart = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
      if (/^[+-]\d{2}:?\d{2}$/.test(offset)) {
        const norm = offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
        const d = new Date(`${String(dateRaw).trim()}T${timePart}${norm}`); if (!Number.isNaN(d.getTime())) return d;
      }
      const zoned = zonedDateToUtc(String(dateRaw).trim(), timePart, offset); if (zoned) return zoned;
      const d = new Date(String(dateRaw).trim()); if (Number.isNaN(d.getTime())) return null;
      d.setHours(hour, minute, second, 0); return d;
    }
    const combined = dateRaw && !/[T\s]\d{1,2}:\d{2}/.test(original) ? `${dateRaw} ${original}` : original;
    if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}|T\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(combined)) { const d = new Date(combined); return Number.isNaN(d.getTime()) ? null : d; }
    return null;
  }
  function getCountdown(startAt) {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) return { label: 'STARTS', value: 'SOON', secondsLeft: null, ring: 0, soon: false };
    const diff = startAt.getTime() - Date.now();
    if (diff <= 0) return { label: 'STARTING', value: 'NOW', secondsLeft: 0, ring: 100, soon: true };
    const total = Math.floor(diff / 1000);
    const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    const soon = total <= 600;
    const value = d > 0 ? `${d}D ${pad(h)}H ${pad(m)}M` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    // ring fills during the final 3 hours
    const ring = Math.max(0, Math.min(100, (1 - total / (3 * 3600)) * 100));
    return { label: soon ? 'STARTING SOON' : 'STARTS IN', value, secondsLeft: total, ring, soon };
  }

  /* ---------------- feed field reader (ported) ---------------- */
  const compactKey = k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function readField(source, keys, depth = 0) {
    if (source == null || depth > 3) return null;
    const wanted = new Set(keys.map(compactKey));
    if (Array.isArray(source)) {
      for (const item of source) { const f = readField(item, keys, depth + 1); if (f !== null && f !== undefined && String(f).trim() !== '') return f; }
      return null;
    }
    if (typeof source !== 'object') return null;
    for (const [k, v] of Object.entries(source)) if (wanted.has(compactKey(k)) && v !== null && v !== undefined && typeof v !== 'object' && String(v).trim() !== '') return v;
    for (const v of Object.values(source)) if (v && typeof v === 'object') { const f = readField(v, keys, depth + 1); if (f !== null && f !== undefined && String(f).trim() !== '') return f; }
    return null;
  }

  /* ---------------- match state (ported logic) ---------------- */
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const ordinal = n => { n = Number(n) || 1; return n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`; };
  const sr = (r, b) => { r = Number(r); b = Number(b); return b > 0 ? ((r / b) * 100).toFixed(1) : '0.0'; };
  const matchOversLimit = f => { f = String(f || '').toUpperCase(); if (f.includes('T10')) return 10; if (f.includes('T20') || f.includes('TWENTY20')) return 20; if (f.includes('ODI') || f.includes('ONE DAY')) return 50; return null; };

  function teamFromText(text, batting, bowling) {
    const hay = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!hay) return '';
    const has = name => { const c = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return c && (hay.includes(c) || c.split(' ').filter(Boolean).every(t => hay.includes(t))); };
    if (has(batting)) return batting; if (has(bowling)) return bowling; return '';
  }

  const START_KEYS = ['start_time', 'startTime', 'match_time', 'matchTime', 'scheduled_time', 'scheduledTime', 'start_at', 'startAt', 'match_start', 'matchStart', 'start', 'time', 'datetime', 'date_time', 'dateTime', 'timestamp', 'start_timestamp', 'startTimestamp', 'start_ts', 'startTs', 'stime', 'tm'];
  const EVENT_KEYS = ['series', 'series_name', 'seriesName', 'competition', 'competition_name', 'competitionName', 'tournament', 'tournament_name', 'tournamentName', 'stage', 'round', 'match_desc', 'matchDesc', 'subtitle', 'title'];
  const ZONE_KEYS = ['timezone', 'time_zone', 'tz', 'tz_name', 'timeZone', 'utc_offset', 'utcOffset', 'offset'];
  const DATE_KEYS = ['match_date', 'matchDate', 'start_date', 'startDate', 'date'];
  const RESULT_KEYS = ['result_text', 'resultText', 'match_result', 'matchResult', 'result', 'final_result', 'finalResult', 'message'];
  const WINNER_KEYS = ['winner_team', 'winnerTeam', 'winning_team', 'winningTeam', 'winner'];

  function deriveMatchState(data, n, score, batting, bowling) {
    const pick = keys => readField(data?.meta, keys) ?? readField(data?.live, keys) ?? '';
    const statusRaw = readField(data?.live, ['match_status', 'matchStatus', 'status_text', 'statusText', 'status', 'ms', 'state']) ?? n.status ?? '';
    const resultRaw = readField(data?.live, RESULT_KEYS) ?? readField(data?.meta, RESULT_KEYS) ?? '';
    const winnerRaw = readField(data?.live, WINNER_KEYS) ?? readField(data?.meta, WINNER_KEYS) ?? '';
    const dateRaw = pick(DATE_KEYS), startRaw = pick(START_KEYS), eventRaw = pick(EVENT_KEYS), zoneRaw = pick(ZONE_KEYS);
    const timeZone = resolveDisplayTimeZone(zoneRaw);
    const startAt = parseMatchStart(startRaw, dateRaw, zoneRaw);
    const startTime = startAt ? formatInTimeZone(startAt, timeZone) : formatClock(startRaw, dateRaw);
    const countdown = getCountdown(startAt);
    const zoneLabel = timeZoneLabel(timeZone, startAt || new Date());
    const statusText = [statusRaw, resultRaw, eventRaw].filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(String).join(' · ');
    const lower = statusText.toLowerCase();
    const target = Number(n.target);
    const ballsLeft = n.ballsLeft == null ? null : Number(n.ballsLeft);
    const need = n.need == null ? null : Number(n.need);

    let winner = '';
    const wt = String(winnerRaw || '').trim();
    if (wt) {
      if (wt === String(n.battingKey || '')) winner = batting;
      else if (wt === String(n.bowlingKey || '')) winner = bowling;
      else winner = teamFromText(wt, batting, bowling);
    }
    if (!winner && /\bwon\b|\bwins\b|\bwinner\b/i.test(String(resultRaw || ''))) winner = teamFromText(resultRaw, batting, bowling);
    if (!winner && Number.isFinite(target) && target > 0) {
      if (score.runs >= target || need === 0) winner = batting;
      else if ((ballsLeft === 0 || score.wickets >= 10) && score.runs < target - 1) winner = bowling;
    }
    const tieByScore = Number.isFinite(target) && target > 0 && (ballsLeft === 0 || score.wickets >= 10) && score.runs === target - 1;
    const terminalText = /\bwon\b|\bwins\b|\bmatch\s+(?:ended|complete|completed|finished)\b|\bcompleted\b|\bfinished\b|\bno\s+result\b|\babandon(?:ed)?\b|\bcancel(?:led|ed)?\b|\bmatch\s+tied\b|\bdrawn\b|\bmatch\s+draw\b/.test(lower);
    const tied = tieByScore || /\bmatch\s+tied\b|\btied\b|\bdrawn\b|\bmatch\s+draw\b/.test(lower);
    const ended = Boolean(winner || tied || terminalText);
    const scoreIsZero = Number(score.runs || 0) === 0 && Number(score.wickets || 0) === 0 && Number(score.balls || 0) === 0;
    const explicitPre = /\bnot\s+started\b|\byet\s+to\s+start\b|\bupcoming\b|\bscheduled\b|\bfixture\b|\bstarts?\s+(?:at|in)\b/.test(lower);
    const hasLivePlayers = Boolean(n.batters?.length || n.bowler);
    const preMatch = !ended && scoreIsZero && (explicitPre || (Boolean(startTime) && !hasLivePlayers));

    let resultText = String(resultRaw || '').trim();
    if (!resultText && winner && Number.isFinite(target) && target > 0) {
      if (winner === batting) { const w = Math.max(0, 10 - Number(score.wickets || 0)); resultText = `${batting} won by ${w} wicket${w === 1 ? '' : 's'}`; }
      else { const m = Math.max(0, (target - 1) - Number(score.runs || 0)); resultText = `${bowling} won by ${m} run${m === 1 ? '' : 's'}`; }
    }
    if (!resultText && tied) resultText = 'Match tied';
    if (!resultText && ended) resultText = String(statusRaw || 'Match complete');

    const forcedMode = (params.get('endmode') || params.get('mode') || '').toLowerCase();
    const trophyHint = /\bfinal\b|\bchampion(?:s|ship)?\b|\btitle\b|\btrophy\b|\bgrand\s+final\b|\bcup\s+final\b|\bdecider\b|\bseries\s+winner\b/.test(lower);
    const trophyMode = ended && (forcedMode === 'trophy' || demoScene === 'trophy' || trophyHint);

    return { preMatch, ended, tied, winner, resultText, startTime, countdown, timeZone, timeZoneLabel: zoneLabel, eventText: String(eventRaw || ''), trophyMode };
  }

  function winChance(n, score, state) {
    if (state.ended) {
      if (!state.winner) return { bat: 50, bowl: 50, mode: 'FINAL' };
      return state.winner === n.batting ? { bat: 100, bowl: 0, mode: 'FINAL' } : { bat: 0, bowl: 100, mode: 'FINAL' };
    }
    if (state.preMatch) return { bat: 50, bowl: 50, mode: 'PRE-MATCH' };
    const target = Number(n.target), ballsLeft = n.ballsLeft == null ? null : Number(n.ballsLeft), need = n.need == null ? null : Number(n.need);
    if (!(Number.isFinite(target) && target > 0 && Number.isFinite(ballsLeft))) return { bat: 50, bowl: 50, mode: '1ST INNINGS' };
    if (need === 0 || score.runs >= target) return { bat: 100, bowl: 0, mode: 'CHASE COMPLETE' };
    if (ballsLeft <= 0 || Number(score.wickets || 0) >= 10) return { bat: 0, bowl: 100, mode: 'CHASE COMPLETE' };
    const totalBalls = Number(n.totalBalls) || Math.max(1, Number(score.balls || 0) + ballsLeft);
    const scoreProgress = clamp(Number(score.runs || 0) / target, 0, 1.15);
    const ballProgress = clamp(Number(score.balls || 0) / totalBalls, 0, 1);
    const rrr = need / (ballsLeft / 6);
    const crr = Number(score.balls || 0) > 0 ? Number(score.runs || 0) / (Number(score.balls) / 6) : rrr;
    const rateEdge = clamp((crr - rrr) / Math.max(2, rrr), -1, 1);
    const wicketEdge = (clamp(10 - Number(score.wickets || 0), 0, 10) - 5) / 5;
    const late = clamp(1 - (ballsLeft / totalBalls), 0, 1);
    const bat = Math.round(clamp(50 + (scoreProgress - ballProgress) * (52 + 24 * late) + rateEdge * (18 + 12 * late) + wicketEdge * 8, 4, 96));
    return { bat, bowl: 100 - bat, mode: 'LIVE ESTIMATE' };
  }

  /* ---------------- ball helpers ---------------- */
  function classifyBall(v) {
    const x = String(v || '').toUpperCase();
    if (x === 'W' || /^W\+/.test(x)) return 'wicket';
    if (x === '4') return 'four';
    if (x === '6') return 'six';
    if (x === '•' || x === '0' || x === '.') return 'dot';
    if (/WD|NB|LB|^B/.test(x)) return 'extra';
    if (/^\d+$/.test(x)) return 'run';
    return '';
  }
  function overRuns(balls) {
    return (balls || []).reduce((s, v) => {
      const x = String(v || '').toUpperCase();
      if (x === 'W' || x === '•') return s;
      const m = x.match(/^(\d+)/); if (m) return s + Number(m[1]);
      const e = x.match(/^(WD|NB)(\d*)$/); if (e) return s + 1 + Number(e[2] || 0);
      const lb = x.match(/^(LB|B)(\d+)$/); if (lb) return s + Number(lb[2]);
      return s;
    }, 0);
  }
  function eventMeta(ball) {
    const x = String(ball || '').toUpperCase();
    if (x === '4') return { word: 'FOUR', short: '4', sub: 'BOUNDARY', kind: 'four', unit: 'RUNS', color: '#2bd9fe', icon: 'i-ball' };
    if (x === '6') return { word: 'SIX', short: '6', sub: 'MAXIMUM', kind: 'six', unit: 'RUNS', color: '#ffb930', icon: 'i-ball' };
    if (x === 'W' || /^W\+/.test(x)) return { word: 'OUT', short: 'W', sub: 'WICKET', kind: 'wicket', unit: 'WICKET', color: '#ff3d5a', icon: 'i-stumps' };
    if (/^WD/.test(x)) return { word: 'WIDE', short: x, sub: 'EXTRA', kind: 'extra', unit: 'EXTRA', color: '#b794ff' };
    if (/^NB/.test(x)) return { word: 'NO BALL', short: x, sub: 'FREE HIT NEXT', kind: 'extra', unit: 'EXTRA', color: '#b794ff' };
    if (/^LB/.test(x)) return { word: 'LEG BYE', short: x, sub: 'EXTRA', kind: 'extra', unit: 'EXTRA', color: '#b794ff' };
    if (/^B\d/.test(x)) return { word: 'BYE', short: x, sub: 'EXTRA', kind: 'extra', unit: 'EXTRA', color: '#b794ff' };
    if (x === '•' || x === '0') return { word: '0', short: '•', sub: 'DOT BALL', kind: 'dot', unit: 'DOT BALL', color: '#9aa6c4' };
    const r = Number(x);
    if (Number.isFinite(r)) return { word: String(r), short: String(r), sub: 'RUNS', kind: 'run', unit: r === 1 ? 'RUN' : 'RUNS', color: '#6ef0a6' };
    return { word: x || '—', short: x, sub: 'LIVE', kind: 'run', unit: 'BALL', color: '#d7ff3a' };
  }

  function renderBalls(which, balls, animateLatest) {
    const list = (balls || []).filter(v => v !== null && v !== undefined && String(v) !== '');
    const sig = `${list.join(',')}|${animateLatest ? 1 : 0}`;
    for (const el of document.querySelectorAll(`[data-balls="${which}"]`)) {
      if (el.dataset.sig === sig) continue;
      el.dataset.sig = sig;
      el.textContent = '';
      el.classList.toggle('is-compact', list.length > 7);
      el.classList.toggle('is-tight', list.length > 9);
      list.forEach((v, i) => {
        const d = document.createElement('div');
        const cls = classifyBall(v);
        const label = cls === 'dot' ? '•' : String(v);
        d.className = `ball ${cls}${label.length > 2 ? ' is-small-text' : ''}${animateLatest && i === list.length - 1 ? ' is-new' : ''}`;
        d.textContent = label;
        d.title = `Ball ${i + 1}: ${label}`;
        d.style.setProperty('--delay', `${i * 40}ms`);
        el.appendChild(d);
      });
      // empty slots to show the remaining legal deliveries in the over
      if (which === 'current') {
        const legal = list.filter(v => !/WD|NB/i.test(String(v))).length;
        for (let i = legal; i < 6; i++) { const s = document.createElement('div'); s.className = 'ball-slot'; el.appendChild(s); }
      }
      if (!list.length && which === 'previous') { const w = document.createElement('span'); w.className = 'over-waiting'; w.textContent = 'No previous over'; el.appendChild(w); }
    }
  }

  /* ---------------- player photos (ported) ---------------- */
  const photoCache = new Map();
  function resolvePhoto(name, team) {
    const k = `${String(name || '').toLowerCase()}|${String(team || '').toLowerCase()}`;
    if (photoCache.has(k)) return photoCache.get(k);
    const p = (async () => {
      if (location.protocol === 'file:') return null;
      try {
        const r = await fetch(`/api/player-photo?name=${encodeURIComponent(name || '')}&team=${encodeURIComponent(team || '')}`, { cache: 'no-store' });
        if (!r.ok) return null;
        const j = await r.json();
        return j?.ok && j?.url ? j : null;
      } catch { return null; }
    })();
    photoCache.set(k, p);
    return p;
  }
  async function updatePhoto(role, name, team) {
    const img = document.querySelector(`img[data-photo="${role}"]`);
    const frame = document.querySelector(`[data-avatar="${role}"]`);
    if (!img || !frame) return;
    const valid = Boolean(name && !/^Awaiting|^WAITING FOR/i.test(name) && !/^Player\s+[A-Z0-9_-]+$/i.test(name));
    const pk = valid ? `${name}|${team}` : '';
    if (img.dataset.pk === pk) return;
    img.dataset.pk = pk;
    frame.classList.remove('has-photo');
    frame.classList.toggle('photo-loading', valid);
    img.removeAttribute('src');
    img.alt = valid ? `${name} headshot` : '';
    if (!valid) { frame.classList.remove('photo-loading'); return; }
    const photo = await resolvePhoto(name, team);
    if (img.dataset.pk !== pk) return;
    if (!photo?.url) { frame.classList.remove('photo-loading'); return; }
    img.onload = () => { if (img.dataset.pk === pk) { frame.classList.remove('photo-loading'); frame.classList.add('has-photo'); } };
    img.onerror = () => { if (img.dataset.pk === pk) { frame.classList.remove('photo-loading', 'has-photo'); img.removeAttribute('src'); } };
    img.src = photo.url;
  }

  /* ---------------- effects ---------------- */
  function spawnParticles(host, color, count, spread = 160) {
    if (!host || reducedMotion) return;
    host.textContent = '';
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const a = (Math.PI * 2 * i / count) + Math.random() * .3;
      const dist = spread * (.45 + Math.random() * .75);
      p.style.setProperty('--dx', `${Math.cos(a) * dist * 1.5}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
      p.style.setProperty('--size', `${5 + Math.random() * 9}px`);
      p.style.setProperty('--particle', color);
      p.style.setProperty('--pdelay', `${Math.random() * 120}ms`);
      host.appendChild(p);
    }
    setTimeout(() => { host.textContent = ''; }, 1500);
  }

  function showDelivery(ball, detail, overLabel, animate) {
    const m = eventMeta(ball);
    const box = $('delivery');
    if (!box) return;
    box.dataset.kind = m.kind;
    const v = $('deliveryValue');
    const text = (m.kind === 'four' || m.kind === 'six') ? m.short : m.word;
    if (v) {
      v.textContent = text;
      v.classList.toggle('is-word', text.length > 2 && text.length <= 4);
      v.classList.toggle('is-long', text.length > 4);
    }
    bind('deliveryUnit', m.kind === 'four' || m.kind === 'six' ? `${m.word} · ${m.sub}` : m.unit);
    bind('deliveryDetail', detail || m.sub);
    bind('lastBallOver', overLabel || '—');
    if (animate) {
      restartClass(box, 'pop');
      const count = m.kind === 'six' ? 26 : m.kind === 'four' ? 20 : m.kind === 'wicket' ? 22 : 8;
      spawnParticles($('deliveryFx'), m.color, count);
    }
  }

  /* ---- takeover queue (FOUR / SIX / WICKET / FIFTY / HUNDRED) ---- */
  const queue = [];
  let takeoverBusy = false;
  function enqueueTakeover(item) {
    if (!stingersOn || reducedMotion) return;
    if (queue.length > 3) { const i = queue.findIndex(q => q.kind === 'four' || q.kind === 'six'); queue.splice(i >= 0 ? i : 0, 1); }
    queue.push(item);
    if (!takeoverBusy) runQueue();
  }
  function runQueue() {
    const item = queue.shift();
    const el = $('takeover');
    if (!item || !el) { takeoverBusy = false; return; }
    takeoverBusy = true;
    el.dataset.kind = item.kind;
    el.style.setProperty('--hold', `${TAKEOVER_MS}ms`);
    $('tkSub').textContent = item.sub;
    $('tkDetail').textContent = item.detail || '';
    $('tkIconUse').setAttribute('href', `#${item.icon || 'i-ball'}`);
    const word = $('tkWord');
    word.textContent = '';
    [...item.word].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.setProperty('--l', i);
      word.appendChild(s);
    });
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    setTimeout(() => spawnParticles($('tkBurst'), item.color, item.kind === 'six' ? 40 : 28, 420), 260);
    setTimeout(() => { el.classList.remove('show'); setTimeout(runQueue, 260); }, TAKEOVER_MS + 450);
  }

  /* ---------------- per-render memory ---------------- */
  let lastScoreSig = '';
  let lastBallSig = '';
  let lastOverSig = '';
  const lastCard = {};
  const batterRuns = new Map();   // id -> last seen runs (milestones)
  const historyKey = `cricket-live-studio-over-history:${key}`;
  let overState = (() => { try { return JSON.parse(localStorage.getItem(historyKey) || '{}'); } catch { return {}; } })();
  const saveOverState = () => { try { localStorage.setItem(historyKey, JSON.stringify(overState)); } catch { /* storage unavailable */ } };

  function cardPulse(role, sig) {
    if (lastCard[role] && lastCard[role] !== sig) for (const el of document.querySelectorAll(`[data-card="${role}"]`)) restartClass(el, 'updated');
    lastCard[role] = sig;
  }

  function checkMilestones(batters, team) {
    for (const b of batters) {
      if (!b?.id) continue;
      const runs = Number(b.runs);
      if (!Number.isFinite(runs)) continue;
      const prev = batterRuns.get(b.id);
      batterRuns.set(b.id, runs);
      if (prev === undefined) continue;
      for (const mark of [200, 150, 100, 50]) {
        if (prev < mark && runs >= mark) {
          const word = mark === 50 ? 'FIFTY' : mark === 100 ? 'HUNDRED' : mark === 150 ? '150' : 'DOUBLE';
          enqueueTakeover({ kind: 'milestone', word, sub: 'MILESTONE', detail: `${b.name} · ${runs} (${b.balls}) · ${teamInfo(team).code}`, color: '#d7ff3a', icon: 'i-bat' });
          break;
        }
      }
    }
  }

  /* ---------------- over history (ported) ---------------- */
  function updateOvers(n) {
    const api = n.overHistory || {};
    const current = api.current || null, previous = api.previous || null;
    if (current || previous || api.expectedCurrent) {
      const no = current?.over || api.expectedCurrent || (Math.floor((n.score?.balls || 0) / 6) + 1);
      const cb = current?.results || [], pb = previous?.results || [];
      const sig = `${no}|${cb.join(',')}`;
      const animate = Boolean(lastOverSig && sig !== lastOverSig && cb.length);
      lastOverSig = sig;
      bind('prevOverLabel', previous?.over ? `OVER ${previous.over}` : '—');
      bind('currOverLabel', `OVER ${no}`);
      renderBalls('previous', pb, false);
      renderBalls('current', cb, animate);
      bind('prevOverTotal', previous ? (previous.runs ?? overRuns(pb)) : '—');
      bind('currOverTotal', current ? (current.runs ?? overRuns(cb)) : 0, { flash: true });
      return no;
    }
    const balls = n.recent || [];
    const no = Math.floor((n.score?.balls || 0) / 6) + 1;
    if (overState.currentNo && no > overState.currentNo) { overState.previous = overState.current || []; overState.previousNo = overState.currentNo; }
    overState.currentNo = no; overState.current = balls; saveOverState();
    const sig = `${no}|${balls.join(',')}`;
    const animate = Boolean(lastOverSig && sig !== lastOverSig);
    lastOverSig = sig;
    bind('prevOverLabel', overState.previousNo ? `OVER ${overState.previousNo}` : '—');
    bind('currOverLabel', `OVER ${no}`);
    renderBalls('previous', overState.previous || [], false);
    renderBalls('current', balls, animate);
    bind('prevOverTotal', overState.previous?.length ? overRuns(overState.previous) : '—');
    bind('currOverTotal', overRuns(balls), { flash: true });
    return no;
  }

  /* ---------------- confetti (built once) ---------------- */
  (function buildConfetti() {
    const host = document.querySelector('.confetti');
    if (!host) return;
    const colors = ['var(--volt)', 'var(--winner)', 'var(--winner2)', '#ffffff', 'var(--six)'];
    for (let i = 0; i < 46; i++) {
      const c = document.createElement('i');
      c.style.setProperty('--x', `${Math.random() * 100}%`);
      c.style.setProperty('--w', `${5 + Math.random() * 7}px`);
      c.style.setProperty('--c', colors[i % colors.length]);
      c.style.setProperty('--t', `${2.8 + Math.random() * 2.6}s`);
      c.style.setProperty('--d', `${-Math.random() * 5}s`);
      c.style.setProperty('--sway', `${(Math.random() - .5) * 160}px`);
      c.style.setProperty('--r', `${(Math.random() > .5 ? 1 : -1) * (360 + Math.random() * 540)}deg`);
      host.appendChild(c);
    }
  })();

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function setStageState(state, chasing) {
    const cls = stage.classList;
    cls.toggle('is-live', !state.preMatch && !state.ended);
    cls.toggle('is-pre', state.preMatch);
    cls.toggle('is-end', state.ended);
    cls.toggle('is-trophy', Boolean(state.trophyMode));
    cls.toggle('is-soon', Boolean(state.preMatch && state.countdown?.soon));
    cls.toggle('is-chasing', Boolean(chasing));
  }

  function apply(data) {
    const n = data.normalized || {};
    const score = n.score || { score: '0/0', overs: '0.0', balls: 0, runs: 0, wickets: 0 };
    const batting = n.batting || 'Team 1', bowling = n.bowling || 'Team 2';
    const { h, a } = setColors(batting, bowling);
    const state = deriveMatchState(data, n, score, batting, bowling);
    const target = Number(n.target);
    const chasing = Number.isFinite(target) && target > 0;
    setStageState(state, chasing);

    stage.classList.toggle('is-stale', Boolean(data.stale));
    stage.classList.remove('is-offline');
    bind('liveLabel', state.ended ? 'FINAL' : state.preMatch ? 'SOON' : data.stale ? 'DELAYED' : 'LIVE');

    /* teams */
    setMark('home', batting); setMark('away', bowling);
    bind('homeName', String(batting).toUpperCase()); bind('awayName', String(bowling).toUpperCase());
    bind('homeCode', h.code); bind('awayCode', a.code);
    for (const el of $$('.team-name')) el.classList.toggle('is-long', el.textContent.length > 12);

    /* header */
    const eventName = state.eventText || (n.format && n.format !== 'CRICKET' ? `${n.format} · LIVE CRICKET` : 'LIVE CRICKET');
    bind('eventName', eventName);
    bind('format', String(n.format || 'CRICKET').toUpperCase());
    bind('inningsLabel', state.preMatch ? 'PRE-MATCH' : state.ended ? 'RESULT' : `${ordinal(n.innings)} INNINGS`);
    const venue = String(n.venue || '').trim();
    bind('venue', venue || 'Venue to be announced');

    /* pre-match */
    if (state.preMatch) {
      bind('homeRole', 'TEAM 1'); bind('awayRole', 'TEAM 2');
      bind('preKicker', state.startTime ? `MATCH DAY · ${state.startTime}` : 'UPCOMING MATCH');
      bind('preStatus', state.eventText || venue || `${batting} vs ${bowling}`);
      bind('preEvent', state.eventText || 'MATCH DAY');
      bind('startTime', state.startTime || 'TBC');
      bind('timeZone', `${state.timeZoneLabel} · ${state.timeZone}`);
      bind('countLabel', state.countdown.label);
      bind('countValue', state.countdown.value);
      for (const el of $$('[data-bind="countValue"]')) el.classList.toggle('is-long', state.countdown.value.length > 8);
      const ring = $('ringFill'); if (ring) ring.style.strokeDasharray = `${state.countdown.ring.toFixed(2)} 100`;
      bind('barMessage', state.startTime ? `FIRST BALL ${state.startTime} ${state.timeZoneLabel}` : 'MATCH SCHEDULED');
      bind('winMode', 'PRE-MATCH');
      meter('progress', 0);
      lastBallSig = '';
      return;
    }

    /* score */
    const sig = `${score.score}|${score.overs}`;
    if (lastScoreSig && sig !== lastScoreSig && !state.ended) restartClass($('scoreCore'), 'bump');
    lastScoreSig = sig;
    roll('score', score.score || '0/0');
    roll('overs', score.overs || '0.0');
    bind('oversLabel', n.totalOvers ? `OF ${n.totalOvers} OV` : 'OVERS');
    roll('finalScore', score.score || '0/0');
    bind('finalOvers', score.overs || '0.0');

    /* ended */
    if (state.ended) {
      bind('homeRole', state.winner === batting ? 'WINNER' : 'FINAL');
      bind('awayRole', state.winner === bowling ? 'WINNER' : 'FINAL');
      const winnerName = state.winner || (state.tied ? 'MATCH TIED' : 'MATCH COMPLETE');
      bind('endKicker', state.trophyMode ? 'FINAL · CHAMPIONS' : 'FINAL RESULT');
      bind('winnerEyebrow', state.trophyMode ? (state.winner ? 'TOURNAMENT CHAMPIONS' : 'FINAL RESULT') : (state.winner ? 'MATCH WINNER' : 'RESULT'));
      bind('winnerName', String(winnerName).toUpperCase());
      for (const el of $$('.winner-name')) { const L = el.textContent.length; el.classList.toggle('is-long', L > 7 && L <= 12); el.classList.toggle('is-xlong', L > 12); }
      bind('resultText', state.resultText || 'Match complete');
      bind('trophyLabel', state.trophyMode ? 'CHAMPIONS' : 'WINNER');
      bind('barMessage', state.trophyMode ? 'CHAMPIONS CROWNED' : 'MATCH COMPLETE');
      if (state.winner) { applyWinnerTheme(state.winner); setMark('winner', state.winner); }
      else setMark('winner', '', true);
    } else {
      bind('homeRole', 'BATTING'); bind('awayRole', 'BOWLING');
      bind('scoreKicker', chasing ? `CHASING ${target}` : 'LIVE SCORE');
    }

    /* status lines */
    const need = Number(n.need), ballsLeft = n.ballsLeft == null ? null : Number(n.ballsLeft);
    let statusLine;
    if (state.ended) statusLine = state.resultText;
    else if (chasing && need > 0) statusLine = `${h.code} need ${need} run${need === 1 ? '' : 's'} from ${ballsLeft ?? '—'} ball${ballsLeft === 1 ? '' : 's'}`;
    else if (n.decision) statusLine = n.decision;
    else statusLine = `${ordinal(n.innings)} innings · CRR ${n.crr ?? '0.00'}`;
    bind('status', statusLine);
    if (!state.ended) bind('barMessage', chasing && need > 0 ? `NEED ${need} OFF ${ballsLeft ?? '—'} · RRR ${n.rrr}` : `CRR ${n.crr ?? '0.00'}${n.partnership ? ` · P'SHIP ${n.partnership.runs ?? 0} (${n.partnership.balls ?? 0})` : ''}`);

    /* players */
    const b1 = n.batters?.[0], b2 = n.batters?.[1], bw = n.bowler;
    bind('b1Name', b1?.name || 'Awaiting batter');
    roll('b1Runs', b1?.runs ?? '—'); bind('b1Balls', b1?.balls ?? '—');
    bind('b1Fours', b1?.fours ?? '—', { flash: true }); bind('b1Sixes', b1?.sixes ?? '—', { flash: true }); bind('b1Sr', b1 ? sr(b1.runs, b1.balls) : '—');
    bind('b2Name', b2?.name || 'Awaiting batter');
    roll('b2Runs', b2?.runs ?? '—'); bind('b2Balls', b2?.balls ?? '—');
    bind('b2Fours', b2?.fours ?? '—', { flash: true }); bind('b2Sixes', b2?.sixes ?? '—', { flash: true }); bind('b2Sr', b2 ? sr(b2.runs, b2.balls) : '—');
    bind('bwName', bw?.name || 'Awaiting bowler');
    roll('bwFigures', bw ? `${bw.wickets ?? '—'}-${bw.runs ?? '—'}` : '—');
    bind('bwOvers', bw?.overs ?? '—'); bind('bwEco', bw?.economy ?? '—'); bind('bwMaidens', bw?.maidens ?? '—'); bind('bwBalls', bw?.balls ?? '—');
    for (const [role, p] of [['striker', b1], ['nonStriker', b2], ['bowler', bw]]) {
      for (const el of document.querySelectorAll(`.player[data-card="${role}"]`)) el.classList.toggle('is-waiting', !p);
    }
    cardPulse('striker', b1 ? `${b1.id}|${b1.runs}|${b1.balls}` : '');
    cardPulse('nonStriker', b2 ? `${b2.id}|${b2.runs}|${b2.balls}` : '');
    cardPulse('bowler', bw ? `${bw.id}|${bw.wickets}|${bw.runs}|${bw.balls}` : '');
    updatePhoto('striker', b1?.name, batting);
    updatePhoto('nonStriker', b2?.name, batting);
    updatePhoto('bowler', bw?.name, bowling);

    /* metrics */
    const crr = Number(n.crr), rrr = Number(n.rrr);
    roll('crr', Number.isFinite(crr) ? crr.toFixed(2) : '0.00');
    meter('crr', (crr || 0) / 14);
    const maxOvers = Number.isFinite(Number(n.totalOvers)) && n.totalOvers ? Number(n.totalOvers) : matchOversLimit(n.format);
    const projected = maxOvers && Number.isFinite(crr) && score.balls > 0 && !chasing ? Math.round(score.runs + crr * ((maxOvers * 6 - score.balls) / 6)) : null;
    bind('crrNote', projected ? `PROJ ${projected}` : score.balls > 12 ? `${(Math.round(crr * 10) / 10) || 0} RPO` : 'BUILDING');

    const rrrMetric = document.querySelector('[data-metric="rrr"]');
    if (Number.isFinite(rrr) && !state.ended) {
      roll('rrr', rrr.toFixed(2)); meter('rrr', rrr / 14);
      const delta = (crr || 0) - rrr;
      bind('rrrNote', delta >= 0 ? `AHEAD +${delta.toFixed(2)}` : `BEHIND ${delta.toFixed(2)}`);
      if (rrrMetric) rrrMetric.dataset.state = delta >= 0 ? 'ahead' : 'behind';
    } else {
      roll('rrr', '—'); meter('rrr', 0);
      bind('rrrNote', state.ended ? 'FINAL' : `${ordinal(n.innings)} INNINGS`);
      if (rrrMetric) rrrMetric.dataset.state = '';
    }

    const pRuns = Number(n.partnership?.runs || 0), pBalls = Number(n.partnership?.balls || 0);
    roll('pshipRuns', pRuns);
    bind('pshipBalls', `${pBalls} BALL${pBalls === 1 ? '' : 'S'}`);
    bind('pshipNote', pBalls > 0 ? `RR ${(pRuns / (pBalls / 6)).toFixed(2)}` : 'CURRENT STAND');
    meter('pship', pRuns / 100);

    const targetEl = document.querySelector('[data-metric="target"]');
    targetEl?.classList.toggle('is-chasing', chasing && !state.ended);
    if (chasing) {
      bind('targetTitle', state.ended ? 'TARGET' : 'TO WIN');
      roll('target', state.ended ? target : Math.max(0, need));
      bind('targetNote', `TARGET ${target}`);
      bind('targetContext', state.ended ? 'FINAL' : `OFF ${Number.isFinite(ballsLeft) ? Math.max(0, ballsLeft) : '—'} BALLS`);
      meter('target', score.runs / target);
    } else {
      bind('targetTitle', 'TARGET'); roll('target', '—');
      bind('targetNote', 'SETTING TARGET'); bind('targetContext', `${ordinal(n.innings)} INNINGS`);
      meter('target', 0);
    }

    let progress = 0;
    if (state.ended) { progress = 1; bind('progressTitle', 'MATCH'); bind('progressNote', 'COMPLETE'); bind('progressContext', state.winner ? `${teamInfo(state.winner).code} WIN` : 'FINAL'); }
    else if (maxOvers) { progress = score.balls / (maxOvers * 6); bind('progressTitle', 'INNINGS'); bind('progressNote', `${maxOvers} OVERS`); bind('progressContext', `${Math.max(0, maxOvers * 6 - score.balls)} BALLS LEFT`); }
    else { bind('progressTitle', 'INNINGS'); bind('progressNote', 'PROGRESS'); bind('progressContext', `${score.overs} OV`); }
    roll('progressValue', `${Math.round(progress * 100)}%`);
    meter('progress', progress);

    /* win predictor */
    const wc = winChance({ ...n, batting }, score, state);
    roll('winHome', `${wc.bat}%`); roll('winAway', `${wc.bowl}%`);
    bind('winMode', wc.mode);
    meter('winHome', wc.bat / 100);
    $('wpSplit')?.style.setProperty('--v', (wc.bat / 100).toFixed(4));

    /* overs + latest ball */
    const overNo = updateOvers(n);
    if (state.ended) { lastBallSig = ''; return; }

    checkMilestones([b1, b2].filter(Boolean), batting);

    const cur = n.overHistory?.current?.results || n.recent || [];
    const last = cur.slice(-1)[0];
    const ballSig = `${n.overHistory?.current?.over || ''}|${cur.length}|${score.score}|${last || ''}`;
    const detail = `${b1?.name || 'Batter'} · ${bw?.name || 'Bowler'}`;
    const overLabel = `${score.overs} OV`;
    if (lastBallSig && ballSig !== lastBallSig && last) {
      showDelivery(last, detail, overLabel, true);
      const m = eventMeta(last);
      if (['four', 'six', 'wicket'].includes(m.kind)) {
        const striker = m.kind === 'wicket' ? (lastStrikerName || b1?.name) : b1?.name;
        enqueueTakeover({ kind: m.kind, word: m.word === 'OUT' ? 'WICKET' : m.word, sub: m.kind === 'wicket' ? 'BREAKTHROUGH' : m.sub,
          detail: m.kind === 'wicket' ? `${bw?.name || ''} strikes · ${score.score}` : `${striker || ''} · ${score.score}`, color: m.color, icon: m.icon });
      }
    } else if (!lastBallSig) {
      if (last) showDelivery(last, `${score.score} after ${score.overs} overs`, overLabel, false);
      else { const box = $('delivery'); if (box) box.dataset.kind = 'waiting'; bind('lastBallOver', `OVER ${overNo}`); }
    }
    lastBallSig = ballSig;
    lastStrikerName = b1?.name || lastStrikerName;
  }
  let lastStrikerName = '';

  /* ---------------- clock ---------------- */
  function updateClock() {
    const tz = resolveDisplayTimeZone('');
    const opt = { hour: 'numeric', minute: '2-digit' };
    if (isValidTimeZone(tz)) opt.timeZone = tz;
    bind('clock', new Date().toLocaleTimeString([], opt).toUpperCase());
  }

  /* ==========================================================================
     DEMO — a small ball-by-ball simulator so every animation can be previewed
     ========================================================================== */
  const DEMO_VENUE = 'Greenfield International Stadium, Thiruvananthapuram';
  const demoScript = ['1', '•', '4', '1', '•', '6', 'Wd', '2', '•', '4', 'W', '•', '1', '6', '1', '4', '•', '2', '1', '6', 'Nb', '1', '•', '4', '1', 'W', '1', '6'];
  const demoPool = [{ id: '5YW', name: 'Shai Hope' }, { id: 'RP', name: 'Rovman Powell' }, { id: 'SH', name: 'Shimron Hetmyer' }, { id: 'AR', name: 'Andre Russell' }];
  const demoBowlers = [{ id: 'EF', name: 'Prasidh Krishna' }, { id: 'JB', name: 'Jasprit Bumrah' }];
  function freshDemo() {
    return {
      runs: 88, wkts: 0, balls: 77, step: 0, target: 241, pool: 0,
      b1: { id: 'GA', name: 'John Campbell', runs: 44, balls: 37, fours: 5, sixes: 2 },
      b2: { id: '2XL', name: 'Justin Greaves', runs: 38, balls: 40, fours: 6, sixes: 0 },
      bowlers: { EF: { runs: 18, wickets: 1, balls: 23, maidens: 0 }, JB: { runs: 22, wickets: 0, balls: 30, maidens: 1 } },
      bowlerIdx: 0, curr: ['1', '•', '4', '1', '•'], prev: ['1', '1', '•', '2', '1', '4'], currNo: 13, pRuns: 82, pBalls: 77
    };
  }
  let sim = freshDemo();
  function simBall() {
    const r = demoScript[sim.step % demoScript.length]; sim.step++;
    const bwl = demoBowlers[sim.bowlerIdx], bs = sim.bowlers[bwl.id];
    const legal = !/WD|NB/i.test(r);
    if (legal) { sim.balls++; bs.balls++; sim.b1.balls++; sim.pBalls++; }
    if (r === 'W') {
      sim.wkts++; bs.wickets++;
      const nb = demoPool[sim.pool++ % demoPool.length];
      sim.b1 = { ...nb, runs: 0, balls: 0, fours: 0, sixes: 0 };
      sim.pRuns = 0; sim.pBalls = 0;
    } else if (/^WD|^NB/i.test(r)) { sim.runs++; bs.runs++; sim.pRuns++; }
    else {
      const x = r === '•' ? 0 : Number(r);
      sim.runs += x; bs.runs += x; sim.b1.runs += x; sim.pRuns += x;
      if (x === 4) sim.b1.fours++; if (x === 6) sim.b1.sixes++;
      if (x % 2 === 1) [sim.b1, sim.b2] = [sim.b2, sim.b1];
    }
    sim.curr.push(r === 'Wd' ? 'Wd' : r);
    if (legal && sim.balls % 6 === 0) {
      sim.prev = sim.curr; sim.curr = []; sim.currNo++;
      [sim.b1, sim.b2] = [sim.b2, sim.b1];
      sim.bowlerIdx = (sim.bowlerIdx + 1) % demoBowlers.length;
    }
    if (sim.runs >= sim.target || sim.wkts >= 10) sim = freshDemo();
  }
  function demoLive() {
    const bwl = demoBowlers[sim.bowlerIdx], bs = sim.bowlers[bwl.id];
    const ov = b => `${Math.floor(b / 6)}.${b % 6}`;
    const ballsLeft = 300 - sim.balls, need = Math.max(0, sim.target - sim.runs);
    const score = { runs: sim.runs, wickets: sim.wkts, balls: sim.balls, overs: ov(sim.balls), score: `${sim.runs}/${sim.wkts}` };
    const bowler = { id: bwl.id, name: bwl.name, runs: bs.runs, wickets: bs.wickets, balls: bs.balls, overs: ov(bs.balls), maidens: bs.maidens, economy: (bs.runs / (bs.balls / 6)).toFixed(2) };
    return {
      fetchedAt: Date.now(), stale: false, playerMapStats: { resolved: 6 }, live: { ms: 'Live' }, meta: [{ v: DEMO_VENUE, series_name: 'ODI Series · Match 2' }],
      normalized: {
        battingKey: 'V', bowlingKey: 'O', batting: 'West Indies', bowling: 'India', format: 'ODI', innings: 2, venue: DEMO_VENUE, decision: 'India opt to bowl', status: 'Live',
        score, batters: [{ ...sim.b1 }, { ...sim.b2 }], bowler, recent: sim.curr.slice(),
        overHistory: { expectedCurrent: sim.currNo + 1, current: sim.curr.length ? { over: sim.currNo + 1, results: sim.curr.slice(), runs: overRuns(sim.curr) } : null, previous: { over: sim.currNo, results: sim.prev.slice(), runs: overRuns(sim.prev) } },
        partnership: { runs: sim.pRuns, balls: sim.pBalls }, target: sim.target, crr: (sim.runs / (sim.balls / 6)).toFixed(2), rrr: (need / (ballsLeft / 6)).toFixed(2), need, ballsLeft, totalBalls: 300, totalOvers: 50
      }
    };
  }
  function demoData(scene) {
    if (scene === 'prematch') {
      const start = new Date(Date.now() + 95 * 60 * 1000);
      return {
        fetchedAt: Date.now(), stale: false, playerMapStats: { resolved: 0 }, live: { ms: 'Not started', speech_names: { O: 'India', V: 'West Indies' } },
        meta: [{ team1: 'India', team2: 'West Indies', v: DEMO_VENUE, match_date: start.toISOString().slice(0, 10), start_time: start.toISOString(), series_name: 'ODI Series · Match 1' }],
        normalized: { battingKey: 'O', bowlingKey: 'V', batting: 'India', bowling: 'West Indies', format: 'ODI', innings: 1, venue: DEMO_VENUE, decision: '', status: 'Not started', score: { runs: 0, wickets: 0, balls: 0, overs: '0.0', score: '0/0' }, batters: [], bowler: null, recent: [], overHistory: { expectedCurrent: 1 }, partnership: { runs: 0, balls: 0 }, target: null, crr: '0.00', rrr: '—', need: null, ballsLeft: 300, totalBalls: 300, totalOvers: 50 }
      };
    }
    if (scene === 'end' || scene === 'ended' || scene === 'final' || scene === 'trophy') {
      const trophy = scene === 'trophy';
      return {
        fetchedAt: Date.now(), stale: false, playerMapStats: { resolved: 3 },
        live: { ms: 'Match completed', result: 'India won by 8 wickets', winner: 'India', stage: trophy ? 'Grand Final' : undefined },
        meta: [{ v: DEMO_VENUE, series_name: trophy ? 'Asia Cup Final' : 'ODI Series · Match 1' }],
        normalized: { battingKey: 'O', bowlingKey: 'V', batting: 'India', bowling: 'West Indies', format: 'ODI', innings: 2, venue: DEMO_VENUE, decision: 'India opt to bowl', status: 'Match completed',
          score: { runs: 300, wickets: 2, balls: 250, overs: '41.4', score: '300/2' },
          batters: [{ id: '41', name: 'Virat Kohli', runs: 139, balls: 88, fours: 10, sixes: 9 }, { id: 'E5', name: 'Ruturaj Gaikwad', runs: 13, balls: 19, fours: 0, sixes: 0 }],
          bowler: { id: '5YW', name: 'Keacy Carty', runs: 17, wickets: 0, balls: 4, overs: '0.4', maidens: 0, economy: '25.50' },
          recent: ['1', '1', '6', '6'], overHistory: { expectedCurrent: 42, current: { over: 42, results: ['Wd', '1', '1', '6', '6'], runs: 15 }, previous: { over: 41, results: ['1', '4', '1', '1', '4', '1'], runs: 12 } },
          partnership: { runs: 75, balls: 46 }, target: 296, crr: '7.20', rrr: '0.00', need: 0, ballsLeft: 50, totalBalls: 300, totalOvers: 50 }
      };
    }
    return demoLive();
  }

  /* ---------------- polling ---------------- */
  let failures = 0;
  async function tick() {
    updateClock();
    if (demo) { apply(demoData(demoScene)); return; }
    try {
      const r = await fetch(`/api/state?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      apply(await r.json());
      failures = 0;
    } catch (e) {
      failures++;
      if (failures >= 3) { stage.classList.add('is-offline'); bind('liveLabel', 'RECONNECTING'); }
      console.warn('[cricket-live-studio] feed error', e.message);
    }
  }

  let demoTimer = null;
  function startDemoAutoplay() {
    clearInterval(demoTimer);
    if (!demo || !autoplay) return;
    demoTimer = setInterval(() => { if (demoScene === 'live') { simBall(); apply(demoData('live')); } }, Math.max(1500, Number(params.get('pace')) || 3800));
  }

  function setScene(s) { demoScene = s; lastBallSig = ''; apply(demoData(demoScene)); }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'l') { setLayout(body.classList.contains('layout-bar') ? 'studio' : 'bar'); return; }
    if (!demo) return;
    if (k === 'arrowright' || k === ' ') { demoScene = 'live'; simBall(); apply(demoData('live')); }
    if (k === '1') setScene('live');
    if (k === '2') setScene('prematch');
    if (k === '3') setScene('end');
    if (k === '4') setScene('trophy');
    if (k === 'f') enqueueTakeover({ kind: 'four', word: 'FOUR', sub: 'BOUNDARY', detail: 'Manual trigger', color: '#2bd9fe', icon: 'i-ball' });
    if (k === 's' || k === '6') enqueueTakeover({ kind: 'six', word: 'SIX', sub: 'MAXIMUM', detail: 'Manual trigger', color: '#ffb930', icon: 'i-ball' });
    if (k === 'w') enqueueTakeover({ kind: 'wicket', word: 'WICKET', sub: 'BREAKTHROUGH', detail: 'Manual trigger', color: '#ff3d5a', icon: 'i-stumps' });
    if (k === 'm') enqueueTakeover({ kind: 'milestone', word: 'FIFTY', sub: 'MILESTONE', detail: 'Manual trigger', color: '#d7ff3a', icon: 'i-bat' });
  });

  // control-room commands (index.html sends these to the preview iframe)
  window.addEventListener('message', e => {
    if (e.origin !== location.origin && location.protocol !== 'file:') return;
    const msg = e.data || {};
    if (msg.type === 'layout') setLayout(msg.layout);
    if (!demo) return;
    if (msg.type === 'scene') setScene(String(msg.scene || 'live'));
    if (msg.type === 'ball') { demoScene = 'live'; simBall(); apply(demoData('live')); }
    if (msg.type === 'stinger') {
      const map = { four: ['FOUR', 'BOUNDARY', '#2bd9fe', 'i-ball'], six: ['SIX', 'MAXIMUM', '#ffb930', 'i-ball'], wicket: ['WICKET', 'BREAKTHROUGH', '#ff3d5a', 'i-stumps'], milestone: ['FIFTY', 'MILESTONE', '#d7ff3a', 'i-bat'] };
      const m = map[msg.kind]; if (m) enqueueTakeover({ kind: msg.kind, word: m[0], sub: m[1], detail: 'Control room trigger', color: m[2], icon: m[3] });
    }
  });

  tick();
  setInterval(tick, demo ? 1000 : POLL_MS);
  startDemoAutoplay();
})();
