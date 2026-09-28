const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const MATCH_KEY = process.env.MATCH_KEY || '11AI';
const POLL_MS = Math.max(900, Number(process.env.POLL_MS || 1000));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PLAYER_MAP_URL = 'https://oc.crickapi.com/mapping/getHomeMapData';
const upstreamCache = new Map();
const scorecardMemory = new Map();
const playerNameCache = new Map();
const playerPhotoCache = new Map();
const PLAYER_PHOTO_CACHE_MS = Math.max(60_000, Number(process.env.PLAYER_PHOTO_CACHE_MS || 86_400_000));
const PLAYER_PHOTO_MODE = String(process.env.PLAYER_PHOTO_MODE || 'auto').toLowerCase();
const ICC_PLAYER_MAP_FILE = path.join(__dirname, 'icc-player-ids.json');
const ICC_AUTO_DISCOVERY = !/^(0|false|off|no)$/i.test(String(process.env.ICC_AUTO_DISCOVERY || '1'));
const ICC_SEARCH_URL = 'https://www.icc-cricket.com/search';
const ICC_DISCOVERY_TIMEOUT_MS = Math.max(2500, Number(process.env.ICC_DISCOVERY_TIMEOUT_MS || 7000));
const ICC_NEGATIVE_CACHE_MS = Math.max(60_000, Number(process.env.ICC_NEGATIVE_CACHE_MS || 21_600_000));
const iccDiscoveryInFlight = new Map();
const iccNegativeCache = new Map();
const iccHeadshotProbeCache = new Map();
let iccPlayerMap = {};
try { iccPlayerMap = JSON.parse(fs.readFileSync(ICC_PLAYER_MAP_FILE, 'utf8')); } catch (_) { iccPlayerMap = {}; }

function normalizePlayerNameKey(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function iccMapKeys(name, team='') {
  const n = normalizePlayerNameKey(name);
  const t = normalizePlayerNameKey(team);
  return [t ? `${n}|${t}` : '', n].filter(Boolean);
}

function getICCMapEntry(name, team='') {
  for (const key of iccMapKeys(name, team)) {
    const raw = iccPlayerMap[key];
    if (raw) return raw;
  }
  return null;
}

function iccHeadshotUrl(id) {
  return `https://images.icc-cricket.com/image/upload/t_player-headshot-portrait-lg-webp/prd/assets/players/generic/colored/${encodeURIComponent(String(id))}.png`;
}

function resolveICCPlayerPhoto(name, team='') {
  const raw = getICCMapEntry(name, team);
  if (!raw) return null;
  const id = typeof raw === 'object' ? raw.id : raw;
  const profile = typeof raw === 'object' ? raw.profile : null;
  if (!id) return null;
  if (typeof raw === 'object' && raw.hasHeadshot === false) return null;
  return {
    url: iccHeadshotUrl(id),
    source: typeof raw === 'object' && raw.discovered ? 'icc-auto' : 'icc',
    iccId: String(id),
    pageUrl: profile || null
  };
}

function saveICCPlayerMap() {
  try {
    const tmp = `${ICC_PLAYER_MAP_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(iccPlayerMap, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, ICC_PLAYER_MAP_FILE);
  } catch (error) {
    console.warn('Could not persist ICC player cache:', error.message);
  }
}

function decodeHtmlEntities(s='') {
  return String(s)
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/\\u002F/gi,'/').replace(/\\\//g,'/');
}

function slugToName(slug='') {
  return String(slug).replace(/[-_]+/g,' ').trim();
}

function teamCodeGuess(team='') {
  const k = normalizePlayerNameKey(team);
  const known = {
    'india':'IND','west indies':'WI','pakistan':'PAK','australia':'AUS','england':'ENG',
    'new zealand':'NZ','south africa':'SA','sri lanka':'SL','bangladesh':'BAN','afghanistan':'AFG',
    'ireland':'IRE','zimbabwe':'ZIM','nepal':'NEP','united states':'USA','usa':'USA','canada':'CAN',
    'netherlands':'NED','scotland':'SCO','united arab emirates':'UAE','uae':'UAE','oman':'OMA',
    'namibia':'NAM','papua new guinea':'PNG','hong kong':'HK','kenya':'KEN','uganda':'UGA'
  };
  if (known[k]) return known[k];
  const words = k.split(/\s+/).filter(Boolean);
  return words.length === 1 ? words[0].slice(0,3).toUpperCase() : words.map(w=>w[0]).join('').slice(0,3).toUpperCase();
}

function parseICCSearchCandidates(html, name='', team='') {
  const text = decodeHtmlEntities(html);
  const out = new Map();
  const patterns = [
    { re: /(?:https?:\/\/(?:www\.)?icc-cricket\.com)?(\/rankings\/(\d+)\/([a-z0-9-]+))/gi, kind:'rankings' },
    { re: /(?:https?:\/\/(?:www\.)?icc-cricket\.com)?((?:\/tournaments\/[^"'<>\s]+)?\/players\/(\d+)\/([a-z0-9-]+))/gi, kind:'players' }
  ];
  const target = normalizePlayerNameKey(name);
  const teamNorm = normalizePlayerNameKey(team);
  const teamCode = teamCodeGuess(team);
  for (const {re,kind} of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const pathPart = m[1];
      const id = m[2];
      const slug = m[3];
      if (!id || !slug) continue;
      const key = `${id}|${slug}`;
      const slugNorm = normalizePlayerNameKey(slugToName(slug));
      const start = Math.max(0, m.index - 260), end = Math.min(text.length, re.lastIndex + 260);
      const context = normalizePlayerNameKey(text.slice(start,end));
      let score = 0;
      if (slugNorm === target) score += 100;
      else if (slugNorm.includes(target) || target.includes(slugNorm)) score += 55;
      const targetTokens = target.split(/\s+/).filter(Boolean);
      if (targetTokens.length && targetTokens.every(t => slugNorm.includes(t))) score += 30;
      if (kind === 'rankings') score += 12;
      if (teamNorm && context.includes(teamNorm)) score += 22;
      if (teamCode && new RegExp(`(^|[^A-Z])${teamCode}([^A-Z]|$)`,'i').test(text.slice(start,end))) score += 14;
      const existing = out.get(key);
      if (!existing || score > existing.score) {
        out.set(key, { id:String(id), slug, score, profile:`https://www.icc-cricket.com${pathPart}`, kind });
      }
    }
  }
  return [...out.values()].sort((a,b)=>b.score-a.score);
}

function iccHeaders() {
  const contact = String(process.env.PLAYER_PHOTO_CONTACT || 'scoreboard-admin').trim();
  return {
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    referer: 'https://www.icc-cricket.com/',
    'user-agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 CricketScoreboard/1.0 (${contact})`
  };
}

async function fetchTextSimple(url, timeoutMs = ICC_DISCOVERY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: iccHeaders(), cache:'no-store', redirect:'follow', signal:controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

async function probeICCHeadshot(id) {
  const key = String(id || '');
  if (!key) return false;
  const cached = iccHeadshotProbeCache.get(key);
  if (cached && Date.now() - cached.at < PLAYER_PHOTO_CACHE_MS) return cached.ok;
  const url = iccHeadshotUrl(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(5000, ICC_DISCOVERY_TIMEOUT_MS));
  try {
    let r = await fetch(url, { method:'HEAD', headers:{ 'user-agent':iccHeaders()['user-agent'], accept:'image/avif,image/webp,image/*,*/*;q=0.8' }, redirect:'follow', signal:controller.signal });
    if (r.status === 405 || r.status === 403) {
      r = await fetch(url, { method:'GET', headers:{ 'user-agent':iccHeaders()['user-agent'], accept:'image/avif,image/webp,image/*,*/*;q=0.8', range:'bytes=0-0' }, redirect:'follow', signal:controller.signal });
    }
    const type = String(r.headers.get('content-type') || '').toLowerCase();
    const ok = r.ok && (type.startsWith('image/') || type === 'application/octet-stream' || !type);
    iccHeadshotProbeCache.set(key,{at:Date.now(),ok});
    return ok;
  } catch (_) {
    // Do not permanently reject a valid player merely because the CDN probe timed out.
    iccHeadshotProbeCache.set(key,{at:Date.now(),ok:true});
    return true;
  } finally { clearTimeout(timer); }
}

function plainTextFromHtml(html='') {
  return decodeHtmlEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
}

async function verifyICCCandidate(candidate, name, team='') {
  try {
    const html = await fetchTextSimple(candidate.profile, Math.min(ICC_DISCOVERY_TIMEOUT_MS, 6000));
    const plain = plainTextFromHtml(html);
    const n = normalizePlayerNameKey(name);
    const p = normalizePlayerNameKey(plain);
    let score = candidate.score;
    if (n && p.includes(n)) score += 40;
    const teamNorm = normalizePlayerNameKey(team);
    if (teamNorm && p.includes(teamNorm)) score += 18;
    const code = teamCodeGuess(team);
    if (code && new RegExp(`(^|\\s)${code}(\\s|$)`,'i').test(plain)) score += 10;
    return { ...candidate, score, verified:true };
  } catch (error) {
    return { ...candidate, verified:false, verifyError:error.message };
  }
}

async function discoverICCPlayer(name, team='', { force=false } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName || !ICC_AUTO_DISCOVERY) return null;
  const mappedRaw = getICCMapEntry(cleanName, team);
  if (!force && mappedRaw && typeof mappedRaw === 'object' && mappedRaw.hasHeadshot === false) {
    return { ok:false, source:'icc-known-no-headshot', url:null, name:cleanName, team, iccId:String(mappedRaw.id || ''), pageUrl:mappedRaw.profile || null };
  }
  const existing = resolveICCPlayerPhoto(cleanName, team);
  if (existing && !force) return existing;
  const lookupKey = iccMapKeys(cleanName, team)[0] || normalizePlayerNameKey(cleanName);
  const neg = iccNegativeCache.get(lookupKey);
  if (!force && neg && Date.now() - neg < ICC_NEGATIVE_CACHE_MS) return null;
  if (iccDiscoveryInFlight.has(lookupKey)) return iccDiscoveryInFlight.get(lookupKey);

  const task = (async () => {
    try {
      const queries = [`${cleanName}${team ? ` ${team}` : ''}`, cleanName];
      let candidates = [];
      for (const q of queries) {
        const url = new URL(ICC_SEARCH_URL);
        url.searchParams.set('q', q);
        const html = await fetchTextSimple(url.toString());
        candidates = parseICCSearchCandidates(html, cleanName, team);
        if (candidates.length) break;
      }
      if (!candidates.length) {
        iccNegativeCache.set(lookupKey, Date.now());
        return null;
      }
      const top = candidates.slice(0, Math.min(3, candidates.length));
      const verified = await Promise.all(top.map(c => verifyICCCandidate(c, cleanName, team)));
      verified.sort((a,b)=>b.score-a.score);
      const best = verified[0] || candidates[0];
      if (!best || best.score < 55) {
        iccNegativeCache.set(lookupKey, Date.now());
        return null;
      }
      const hasHeadshot = await probeICCHeadshot(best.id);
      const entry = { id:String(best.id), profile:best.profile, discovered:true, team:String(team||''), hasHeadshot, updatedAt:new Date().toISOString() };
      iccPlayerMap[lookupKey] = entry;
      if (!team && !iccPlayerMap[normalizePlayerNameKey(cleanName)]) iccPlayerMap[normalizePlayerNameKey(cleanName)] = entry;
      saveICCPlayerMap();
      iccNegativeCache.delete(lookupKey);
      if (!hasHeadshot) return { ok:false, name:cleanName, team, source:'icc-auto-no-headshot', url:null, iccId:String(best.id), pageUrl:best.profile, discoveryScore:best.score };
      return { ok:true, name:cleanName, team, url:iccHeadshotUrl(best.id), source:'icc-auto', iccId:String(best.id), pageUrl:best.profile, discoveryScore:best.score };
    } catch (error) {
      iccNegativeCache.set(lookupKey, Date.now());
      return { ok:false, source:'icc-auto-error', url:null, name:cleanName, team, warning:error.message };
    } finally {
      iccDiscoveryInFlight.delete(lookupKey);
    }
  })();
  iccDiscoveryInFlight.set(lookupKey, task);
  return task;
}
let playerMapRetryAfter = 0;

function playerPhotoSlug(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function findLocalPlayerPhoto(name) {
  const slug = playerPhotoSlug(name);
  if (!slug) return null;
  for (const ext of ['.webp','.jpg','.jpeg','.png']) {
    const full = path.join(PUBLIC_DIR, 'player-faces', slug + ext);
    if (fs.existsSync(full)) return `/player-faces/${slug}${ext}`;
  }
  return null;
}

function wikiHeaders() {
  const contact = String(process.env.PLAYER_PHOTO_CONTACT || 'scoreboard-admin').trim();
  return {
    accept: 'application/json',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': `CricketScoreboard/1.0 (${contact})`,
    'api-user-agent': `CricketScoreboard/1.0 (${contact})`
  };
}

async function fetchJsonSimple(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: wikiHeaders(), cache: 'no-store', redirect: 'follow', signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function scoreWikiCandidate(page, name, team) {
  const title = String(page?.title || '').toLowerCase();
  const desc = String(page?.description || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  const t = String(team || '').toLowerCase();
  let score = 0;
  if (title === n) score += 12;
  if (title.startsWith(n)) score += 8;
  if (/cricketer|cricket player|international cricketer/.test(desc)) score += 12;
  if (/cricket/.test(desc)) score += 5;
  if (t && (title.includes(t) || desc.includes(t))) score += 4;
  if (/footballer|politician|actor|musician|writer|soldier|baseball/.test(desc) && !/cricket/.test(desc)) score -= 15;
  return score;
}

async function resolveWikimediaPlayerPhoto(name, team='') {
  const q = `${name} cricketer${team ? ` ${team}` : ''}`.trim();
  const searchUrl = new URL('https://en.wikipedia.org/w/rest.php/v1/search/page');
  searchUrl.searchParams.set('q', q);
  searchUrl.searchParams.set('limit', '8');
  const search = await fetchJsonSimple(searchUrl.toString());
  const pages = Array.isArray(search?.pages) ? search.pages : [];
  const ranked = pages
    .map(page => ({ page, score: scoreWikiCandidate(page, name, team) }))
    .filter(x => x.score >= 7)
    .sort((a,b) => b.score - a.score);
  const best = ranked[0]?.page;
  if (!best?.title) return null;

  const api = new URL('https://en.wikipedia.org/w/api.php');
  api.searchParams.set('action','query');
  api.searchParams.set('format','json');
  api.searchParams.set('formatversion','2');
  api.searchParams.set('prop','pageimages|pageterms');
  api.searchParams.set('piprop','thumbnail|original');
  api.searchParams.set('pithumbsize','700');
  api.searchParams.set('wbptterms','description');
  api.searchParams.set('redirects','1');
  api.searchParams.set('titles',best.title);
  const detail = await fetchJsonSimple(api.toString());
  const page = detail?.query?.pages?.[0];
  const image = page?.thumbnail?.source || page?.original?.source || best?.thumbnail?.url || null;
  if (!image) return null;
  const pageTitle = page?.title || best.title;
  return {
    url: String(image).startsWith('//') ? `https:${image}` : image,
    title: pageTitle,
    description: page?.terms?.description?.[0] || best?.description || '',
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g,'_'))}`,
    source: 'wikimedia'
  };
}

async function resolvePlayerPhoto(name, team='', { forceICC=false } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName || /^WAITING FOR/i.test(cleanName) || /^PLAYER\s+[A-Z0-9_-]+$/i.test(cleanName)) {
    return { ok:false, source:'none', url:null };
  }
  const local = findLocalPlayerPhoto(cleanName);
  if (local) return { ok:true, source:'local', url:local, name:cleanName };

  const mode = PLAYER_PHOTO_MODE;
  if (mode !== 'off' && mode !== 'wikimedia-only') {
    const mapped = resolveICCPlayerPhoto(cleanName, team);
    if (mapped && !forceICC) return { ok:true, name:cleanName, team, ...mapped };
    if (ICC_AUTO_DISCOVERY && mode !== 'local') {
      const discovered = await discoverICCPlayer(cleanName, team, { force:forceICC });
      if (discovered?.ok && discovered.url) return discovered;
    }
  }

  if (mode === 'off' || mode === 'local' || mode === 'icc') return { ok:false, source:'none', url:null, name:cleanName, team };

  const cacheKey = `${cleanName.toLowerCase()}|${String(team||'').toLowerCase()}`;
  const cached = playerPhotoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PLAYER_PHOTO_CACHE_MS) return cached.value;
  try {
    const resolved = await resolveWikimediaPlayerPhoto(cleanName, team);
    const value = resolved ? { ok:true, name:cleanName, team, ...resolved } : { ok:false, source:'none', url:null, name:cleanName, team };
    playerPhotoCache.set(cacheKey,{at:Date.now(),value});
    return value;
  } catch (error) {
    const value = { ok:false, source:'none', url:null, name:cleanName, team, warning:error.message };
    playerPhotoCache.set(cacheKey,{at:Date.now(),value});
    return value;
  }
}


function feedsFor(key) {
  const k = encodeURIComponent(key);
  return {
    live: `https://cricketlivenow.com/api/sendRequest/?key=${k}`,
    meta: `https://api-v1.com/v10/iV4.php?key=${k}`,
    scorecard: `https://api-v1.com/v10/sC4.php?key=${k}`
  };
}

function fetchHeaders(extra = {}) {
  return {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache', pragma: 'no-cache',
    referer: 'https://cricketlivenow.com/',
    origin: 'https://cricketlivenow.com',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    ...extra
  };
}

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

async function getJson(url, { optional = false, cacheKey = url } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { headers: fetchHeaders(), cache: 'no-store', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) return optional ? [] : {};
    const parsed = JSON.parse(text);
    upstreamCache.set(cacheKey, { value: parsed, at: Date.now() });
    return parsed;
  } catch (error) {
    const cached = upstreamCache.get(cacheKey);
    if (cached) return { __stale: true, __value: cached.value, __error: error.message };
    if (optional) return [];
    throw error;
  } finally { clearTimeout(timer); }
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: fetchHeaders({ 'content-type': 'application/json;charset=UTF-8' }),
      body: JSON.stringify(payload), cache: 'no-store', redirect: 'follow', signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}

function unwrap(v) {
  return v && typeof v === 'object' && v.__stale ? { value: v.__value, stale: true, error: v.__error } : { value: v, stale: false, error: null };
}

function cleanId(v) {
  const id = String(v ?? '').trim();
  return id && id.length <= 32 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function ballsToOvers(balls) { balls = Math.max(0, num(balls)); return `${Math.floor(balls / 6)}.${balls % 6}`; }
function ballsFromOvers(overs) { const [o='0', b='0'] = String(overs || '0.0').split('.'); return num(o) * 6 + num(b); }

// Determine the actual innings length from the match format.
// IMPORTANT: live.R is NOT a normal max-overs field (e.g. an ODI feed can expose R="12+0"),
// so only use R as a reduced-overs hint when the feed explicitly says the innings was reduced.
function inferInningsLimit(live = {}, metaRow = {}, score = {}) {
  const format = String(live?.fo || metaRow?.fo || metaRow?.format || '').trim().toUpperCase();
  const currentBalls = Math.max(0, num(score?.balls));

  // Hundred-style matches are ball-based rather than 6-ball-over based.
  if (/THE\s*HUNDRED|100\s*BALL/.test(format)) {
    return { balls: 100, overs: null, source: 'format:100-ball' };
  }

  let standardOvers = null;
  const t = format.match(/(?:^|\b)T\s*(\d{1,2})(?:\b|$)/);
  if (t) standardOvers = Number(t[1]);
  else if (/TWENTY\s*20|TWENTY20|T20/.test(format)) standardOvers = 20;
  else if (/ODI|ONE\s*DAY|LIST\s*A|50\s*OVER/.test(format)) standardOvers = 50;
  else if (/T10|10\s*OVER/.test(format)) standardOvers = 10;
  else if (/T5|5\s*OVER/.test(format)) standardOvers = 5;
  else if (/TEST|FIRST\s*CLASS|\bFC\b/.test(format)) standardOvers = null;

  const reduced = Boolean(num(live?.over_reduced) || num(metaRow?.over_reduced));
  if (reduced) {
    const rawCandidates = [
      live?.reduced_overs, live?.overs_limit, live?.max_overs, live?.innings_overs,
      metaRow?.reduced_overs, metaRow?.overs_limit, metaRow?.max_overs, metaRow?.innings_overs,
      String(live?.R || '').split('+')[0]
    ];
    for (const raw of rawCandidates) {
      const ov = Number(raw);
      if (!Number.isFinite(ov) || ov <= 0 || ov > 100) continue;
      // Reject impossible/stale limits that are already below the balls bowled.
      if (ov * 6 + 5 < currentBalls) continue;
      return { balls: Math.round(ov * 6), overs: ov, source: 'reduced-overs' };
    }
  }

  if (Number.isFinite(standardOvers) && standardOvers > 0) {
    return { balls: standardOvers * 6, overs: standardOvers, source: 'format' };
  }

  return { balls: null, overs: null, source: 'unknown' };
}

function parseScore(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)(?:\.(\d+))?/);
  if (!m) m = s.match(/(\d+)\s*\/\s*(\d+).*?(\d+)(?:\.(\d+))?/);
  if (!m) {
    const q = s.match(/(\d+)\s*\/\s*(\d+)/);
    return q ? { runs:+q[1], wickets:+q[2], balls:0, overs:'0.0', score:`${q[1]}/${q[2]}` } : null;
  }
  let balls, overs;
  if (m[4] !== undefined) { overs = `${num(m[3])}.${num(m[4])}`; balls = ballsFromOvers(overs); }
  else { balls = num(m[3]); overs = ballsToOvers(balls); }
  return { runs:+m[1], wickets:+m[2], balls, overs, score:`${m[1]}/${m[2]}` };
}

function parseBatter(line) {
  if (typeof line !== 'string') return null;
  const [left, career=''] = line.split('/');
  const p = left.split('.');
  const id = cleanId(p[0]);
  if (!id) return null;
  const current = p.length >= 3 && /^-?\d+$/.test(p[1] || '') && /^-?\d+$/.test(p[2] || '');
  const [avg, careerSr] = career.split('-');
  return { id, current, runs: current ? num(p[1]) : null, balls: current ? num(p[2]) : null, fours: current ? num(p[3]) : null, sixes: current ? num(p[4]) : null, avg: avg || null, careerSr: careerSr || null };
}

function parseBowler(line) {
  if (typeof line !== 'string') return null;
  const p = line.split('.');
  if (p.length < 5) return null;
  const id = cleanId(p[0]);
  const runs = Number(p[1]), balls = Number(p[2]), maidens = Number(p[3]), wickets = Number(p[4]);
  if (!id || ![runs, balls, maidens, wickets].every(Number.isFinite)) return null;
  return { id, runs, balls, maidens, wickets, overs: ballsToOvers(balls), economy: balls ? (runs / (balls / 6)).toFixed(2) : '0.00' };
}

// Fast current-bowler hint from sendRequest.z: ID.BALLS.RUNS.WICKETS.
// This is used only for the bowler card and never changes the stable score parser.
function parseLiveBowlerHint(raw, fallback=null) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const p = raw.split('.');
  if (p.length < 4) return null;
  const id = cleanId(p[0]);
  const balls = Number(p[1]), runs = Number(p[2]), wickets = Number(p[3]);
  if (!id || ![balls, runs, wickets].every(Number.isFinite)) return null;
  const maidens = fallback && fallback.id === id && Number.isFinite(fallback.maidens) ? fallback.maidens : 0;
  return { id, runs, balls, maidens, wickets, overs: ballsToOvers(balls), economy: balls ? (runs / (balls / 6)).toFixed(2) : '0.00' };
}

function parsePair(line) {
  if (typeof line !== 'string') return null;
  const t = line.split('.');
  if (t.length < 8) return null;
  const strikerId = cleanId(t[0]), nonStrikerId = cleanId(t[3]);
  const vals = [Number(t[1]),Number(t[2]),Number(t[4]),Number(t[5]),Number(t[6]),Number(t[7])];
  if (!strikerId || !nonStrikerId || !vals.every(Number.isFinite)) return null;
  return { strikerId, strikerRuns:vals[0], strikerBalls:vals[1], nonStrikerId, nonStrikerRuns:vals[2], nonStrikerBalls:vals[3], runs:vals[4], balls:vals[5] };
}

function parseRecent(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split('.').map(x => {
    const u = String(x).trim().toUpperCase();
    if (!u) return null;
    if (u === '0') return '•';
    if (['W','WK','OUT'].includes(u)) return 'W';
    if (u === 'WD') return 'Wd';
    if (u === 'NB') return 'Nb';
    if (u === 'LB') return 'Lb';
    if (u === 'B') return 'B';
    return u;
  }).filter(Boolean).slice(-8);
}

// Normalize one actual delivery from sendRequest.rb. This is display-only data;
// it does not participate in score, innings, target or batter calculations.
function normalizeRbBall(raw, type=null) {
  const t = Number(type);
  const original = String(raw ?? '').trim();
  const u = original.replace(/\s+/g,'').replace(/\+/g,'').toUpperCase();
  if (t === 1 || ['W','WK','OUT','WICKET'].includes(u)) return 'W';
  if (!u || u === '0' || u === 'DOT' || u === '.') return '•';
  const m = u.match(/^(\d*)(WD|WIDE|NB|NOBALL|LB|LEGBYE|B|BYE)$/);
  if (m) {
    const n = m[1] || '';
    const kind = m[2];
    if (kind === 'WD' || kind === 'WIDE') return `${n}Wd`;
    if (kind === 'NB' || kind === 'NOBALL') return `${n}Nb`;
    if (kind === 'LB' || kind === 'LEGBYE') return `${n}Lb`;
    return `${n}B`;
  }
  if (/^\d+$/.test(u)) return String(Number(u));
  return original || '•';
}

function parseRbOverHistory(rawOvers, activeIndex, battingKey, score) {
  let rows = (Array.isArray(rawOvers) ? rawOvers : []).map((ov, sourceIndex) => {
    if (!ov || typeof ov !== 'object' || !Array.isArray(ov.b)) return null;
    const over = Number(ov.o);
    if (!Number.isFinite(over)) return null;
    const deliveries = ov.b.map((ball, idx) => {
      if (!ball || typeof ball !== 'object') return null;
      return {
        result: normalizeRbBall(ball.u, ball.t),
        delivery: Number.isFinite(Number(ball.d)) ? Number(ball.d) : idx + 1,
        bowlerId: cleanId(ball.bf),
        raw: ball.u ?? null,
        type: ball.t ?? null
      };
    }).filter(Boolean);
    if (!deliveries.length) return null;
    return {
      over,
      inningsIndex: Number.isFinite(Number(ov.i)) ? Number(ov.i) : null,
      battingKey: cleanId(ov.bt) || String(ov.bt || '').trim() || null,
      deliveries,
      results: deliveries.map(x => x.result),
      runs: Number.isFinite(Number(ov.r)) ? Number(ov.r) : null,
      teamScore: String(ov.ts || '').trim() || null,
      sourceIndex
    };
  }).filter(Boolean);

  if (!rows.length) return { current:null, previous:null, rows:[], expectedCurrent:Math.floor(Number(score?.balls||0)/6)+1, latestBall:null, source:null };

  // Filter only the delivery history for the active innings when the feed supplies
  // an innings index. If not, fall back to the active batting-team key.
  if (Number.isInteger(activeIndex) && rows.some(r => r.inningsIndex === activeIndex)) {
    rows = rows.filter(r => r.inningsIndex === activeIndex);
  } else if (battingKey && rows.some(r => r.battingKey === battingKey)) {
    rows = rows.filter(r => r.battingKey === battingKey);
  } else {
    const vals = rows.map(r => r.inningsIndex).filter(Number.isFinite);
    if (vals.length) {
      const latestInnings = Math.max(...vals);
      rows = rows.filter(r => r.inningsIndex === latestInnings);
    }
  }

  // rb may include multiple snapshots of the same over. Keep the newest, most
  // complete snapshot for that over, while retaining the API's chronological order.
  const byOver = new Map();
  for (const row of rows) {
    const old = byOver.get(row.over);
    if (!old || row.deliveries.length > old.deliveries.length ||
        (row.deliveries.length === old.deliveries.length && row.sourceIndex > old.sourceIndex)) {
      byOver.set(row.over, row);
    }
  }
  rows = [...byOver.values()].sort((a,b) => a.sourceIndex - b.sourceIndex);
  const current = rows.at(-1) || null;
  const previous = rows.length > 1 ? rows.at(-2) : null;
  const latest = current?.deliveries?.at(-1) || null;
  return {
    current,
    previous,
    rows: rows.slice(-8),
    expectedCurrent: current?.over || (Math.floor(Number(score?.balls||0)/6)+1),
    latestBall: latest ? { ...latest, over:current.over, inningsIndex:current.inningsIndex, teamScore:current.teamScore } : null,
    source:'live.rb'
  };
}

function detailedBCount(row) {
  return (Array.isArray(row?.b) ? row.b : []).reduce((n, x) => n + (parseBatter(x)?.current ? 1 : 0), 0);
}
function rowIsLive(row) {
  if (!row || typeof row !== 'object') return false;
  if (Array.isArray(row.a) && row.a.some(x => parseBowler(x))) return true;
  if (Array.isArray(row.p) && row.p.some(x => parsePair(x))) return true;
  const s = parseScore(row.d);
  if (s && s.balls > 0) return true;
  return detailedBCount(row) > 0;
}

function mergeScorecard(key, incoming) {
  const next = Array.isArray(incoming) ? incoming : [];
  const prev = scorecardMemory.get(key) || [];
  const prevByTeam = new Map(prev.filter(Boolean).map(r => [String(r.c || ''), r]));
  const merged = next.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const old = prevByTeam.get(String(row.c || ''));
    if (!old) return row;
    const out = { ...old, ...row };
    if ((!Array.isArray(row.a) || !row.a.length) && Array.isArray(old.a) && old.a.length) out.a = old.a;
    if ((!Array.isArray(row.p) || !row.p.length) && Array.isArray(old.p) && old.p.length) out.p = old.p;
    if ((!row.e || !String(row.e).trim()) && old.e) out.e = old.e;
    if (detailedBCount(row) === 0 && detailedBCount(old) > 0) out.b = old.b;
    const ns = parseScore(row.d), os = parseScore(old.d);
    if ((!ns || ns.balls === 0) && os && os.balls > 0) out.d = old.d;
    return out;
  });
  const present = new Set(merged.filter(Boolean).map(r => String(r.c || '')));
  for (const old of prev) if (old && !present.has(String(old.c || ''))) merged.push(old);
  if (merged.length) scorecardMemory.set(key, merged);
  return merged.length ? merged : prev;
}

function selectActiveInnings(scorecard) {
  const rows = (Array.isArray(scorecard) ? scorecard : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
  for (let i = rows.length - 1; i >= 0; i--) if (rowIsLive(rows[i])) return rows[i];
  return rows[0] || null;
}

function extractIds(scorecard, live) {
  const ids = new Set();
  const add = v => { const id = cleanId(v); if (id) ids.add(id); };
  for (const row of Array.isArray(scorecard) ? scorecard : []) {
    if (!row || typeof row !== 'object') continue;
    for (const x of Array.isArray(row.a) ? row.a : []) add(String(x).split('.')[0]);
    for (const x of Array.isArray(row.b) ? row.b : []) add(String(x).split(/[./]/)[0]);
    for (const x of Array.isArray(row.p) ? row.p : []) { const p = String(x).split('.'); add(p[0]); add(p[3]); }
    for (const x of String(row.x || '').split(/[\/|,]/)) add(x);
  }
  add(live?.partnership?.strikerId); add(live?.partnership?.nonStrikerId);
  add(String(live?.z || '').split('.')[0]);
  for (const ov of Array.isArray(live?.rb) ? live.rb : []) {
    for (const ball of Array.isArray(ov?.b) ? ov.b : []) add(ball?.bf);
  }
  return [...ids];
}

function normalizeMapResponse(payload) {
  const roots = Array.isArray(payload) ? payload : [payload], out = {};
  for (const root of roots) {
    for (const item of Array.isArray(root?.p) ? root.p : []) {
      const id = cleanId(item?.f_key ?? item?.fKey ?? item?.key ?? item?.id);
      const name = String(item?.n ?? item?.name ?? item?.player_name ?? '').trim();
      if (id && name) out[id] = name;
    }
  }
  return out;
}

async function resolvePlayerNames(ids) {
  const unique = [...new Set((ids || []).map(cleanId).filter(Boolean))];
  const missing = unique.filter(id => !playerNameCache.has(id));
  let warning = null;
  if (missing.length && Date.now() >= playerMapRetryAfter) {
    try {
      const payload = { p: missing, s: [], u: [], v: [], t: [], lc: 'en' };
      const mapped = normalizeMapResponse(await postJson(PLAYER_MAP_URL, payload));
      for (const [id,name] of Object.entries(mapped)) playerNameCache.set(id,name);
      playerMapRetryAfter = 0;
    } catch (e) { playerMapRetryAfter = Date.now() + 12000; warning = `player mapping: ${e.message}`; }
  }
  const map = {}; for (const id of unique) if (playerNameCache.has(id)) map[id] = playerNameCache.get(id);
  return { map, requested: unique.length, resolved: Object.keys(map).length, warning };
}

function buildNormalized(scorecard, live, meta, playerMap) {
  const active = selectActiveInnings(scorecard);
  const rows = Array.isArray(scorecard) ? scorecard : [];
  const metaRow = Array.isArray(meta) ? (meta[0] || {}) : (meta || {});
  const names = { ...(live?.speech_names || {}) };
  if (metaRow.team1_fkey && metaRow.team1) names[metaRow.team1_fkey] ||= metaRow.team1;
  if (metaRow.team2_fkey && metaRow.team2) names[metaRow.team2_fkey] ||= metaRow.team2;

  const battingKey = active?.c || Object.keys(names)[0] || 'O';
  const bowlingKey = Object.keys(names).find(k => k !== battingKey) || Object.keys(names)[1] || 'V';
  const batting = names[battingKey] || 'Team 1';
  const bowling = names[bowlingKey] || 'Team 2';

  const batterList = (Array.isArray(active?.b) ? active.b : []).map(parseBatter).filter(Boolean);
  const byId = new Map(batterList.map(b => [b.id,b]));
  const pairLines = Array.isArray(active?.p) ? active.p : [];
  const pair = pairLines.length ? parsePair(pairLines[pairLines.length - 1]) : null;
  let batters = [];
  if (pair) {
    // The pair payload identifies striker/non-striker and partnership contribution,
    // but on later partnerships its player run/ball values can be partnership-only.
    // Prefer the detailed current batter row for innings totals, and only fall back
    // to pair values when the detailed row is missing.
    const sRow = byId.get(pair.strikerId);
    const nRow = byId.get(pair.nonStrikerId);
    const s = sRow || { id: pair.strikerId };
    const n = nRow || { id: pair.nonStrikerId };
    batters = [
      {
        ...s,
        runs: sRow?.current && Number.isFinite(sRow.runs) ? sRow.runs : pair.strikerRuns,
        balls: sRow?.current && Number.isFinite(sRow.balls) ? sRow.balls : pair.strikerBalls,
        striker: true
      },
      {
        ...n,
        runs: nRow?.current && Number.isFinite(nRow.runs) ? nRow.runs : pair.nonStrikerRuns,
        balls: nRow?.current && Number.isFinite(nRow.balls) ? nRow.balls : pair.nonStrikerBalls,
        striker: false
      }
    ];
  } else {
    const xIds = String(active?.x || '').split('/').map(cleanId).filter(Boolean);
    const fromX = xIds.map(id => byId.get(id)).filter(Boolean).filter(b => b.current);
    batters = (fromX.length ? fromX : batterList.filter(b => b.current)).slice(0,2).map((b,i) => ({ ...b, striker:i===0 }));
  }
  batters = batters.map(b => ({ ...b, name: playerMap[b.id] || `Player ${b.id}` }));

  const bowlers = (Array.isArray(active?.a) ? active.a : []).map(parseBowler).filter(Boolean);
  const bowlerById = new Map(bowlers.map(b => [b.id,b]));

  // IMPORTANT: keep the proven v27 score path unchanged.
  let score = parseScore(active?.d) || parseScore(live?.j) || { runs:0,wickets:0,balls:0,overs:'0.0',score:'0/0' };
  const activeIndex = rows.indexOf(active);
  const overHistory = parseRbOverHistory(live?.rb, activeIndex, battingKey, score);

  // Bowler may change before the scorecard `a` list refreshes. Use rb/z only for
  // selecting the current bowler; never use them to change the score itself.
  const rbBowlerId = cleanId(overHistory.latestBall?.bowlerId);
  const zBowlerId = cleanId(String(live?.z || '').split('.')[0]);
  const wantedBowlerId = rbBowlerId || zBowlerId || null;
  const zHint = parseLiveBowlerHint(live?.z, wantedBowlerId ? bowlerById.get(wantedBowlerId) : null);
  let bowlerRaw = null;
  if (wantedBowlerId && zHint?.id === wantedBowlerId) bowlerRaw = zHint;
  else if (wantedBowlerId && bowlerById.has(wantedBowlerId)) bowlerRaw = bowlerById.get(wantedBowlerId);
  else if (wantedBowlerId) bowlerRaw = { id:wantedBowlerId, runs:null, balls:null, maidens:null, wickets:null, overs:'—', economy:'—' };
  else bowlerRaw = bowlers.length ? bowlers[bowlers.length - 1] : null;
  const bowler = bowlerRaw ? { ...bowlerRaw, name: playerMap[bowlerRaw.id] || `Player ${bowlerRaw.id}` } : null;

  const recent = overHistory.current?.results?.length ? overHistory.current.results : parseRecent(active?.e);
  let target = null;
  if (activeIndex > 0) {
    for (let i = activeIndex - 1; i >= 0; i--) { const ps = parseScore(rows[i]?.d); if (ps && ps.runs >= 0) { target = ps.runs + 1; break; } }
  }
  const partnership = pair ? { runs:pair.runs, balls:pair.balls } : (live?.partnership || { runs:0, balls:0 });
  const crr = score.balls ? (score.runs / (score.balls / 6)).toFixed(2) : '0.00';
  const inningsLimit = inferInningsLimit(live, metaRow, score);
  const totalBalls = Number.isFinite(inningsLimit.balls) ? inningsLimit.balls : null;
  const totalOvers = Number.isFinite(inningsLimit.overs) ? inningsLimit.overs : null;
  const ballsLeft = totalBalls == null ? null : Math.max(0, totalBalls - score.balls);
  const need = target ? Math.max(0, target - score.runs) : null;
  const rrr = target && ballsLeft != null && ballsLeft > 0 ? (need / (ballsLeft / 6)).toFixed(2) : '—';

  return {
    battingKey, bowlingKey, batting, bowling, score, batters, bowler, recent, overHistory, latestBall: overHistory.latestBall,
    partnership, target, crr, rrr, ballsLeft, need, totalBalls, totalOvers, inningsLimitSource: inningsLimit.source,
    format: live?.fo || metaRow?.fo || 'CRICKET',
    innings: activeIndex >= 0 ? activeIndex + 1 : num(live?.mn,1),
    venue: metaRow?.v || '',
    decision: String(live?.B || '').trim(),
    status: live?.ms,
    activeRaw: active || null
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store, no-cache, must-revalidate', 'access-control-allow-origin':'*' });
  res.end(JSON.stringify(body));
}

function serveStatic(reqPath, res) {
  let file = reqPath === '/' ? '/index.html' : reqPath;
  const safe = path.normalize(file).replace(/^([.][.][/\\])+/, '');
  const full = path.join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err,data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(full).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8' };
    res.writeHead(200, { 'content-type':types[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=60' });
    res.end(data);
  });
}

const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = u.searchParams.get('key') || MATCH_KEY;
  if (u.pathname === '/health') return sendJson(res,200,{ok:true,key,version:'36.0-live-studio-broadcast'});
  if (u.pathname === '/api/config') return sendJson(res,200,{key,pollMs:POLL_MS,version:'36.0-live-studio-broadcast'});
  if (u.pathname === '/api/player-map') {
    const ids = String(u.searchParams.get('ids') || '').split(',').filter(Boolean);
    return sendJson(res,200,await resolvePlayerNames(ids));
  }
  if (u.pathname === '/api/player-photo') {
    const name = String(u.searchParams.get('name') || '').trim();
    const team = String(u.searchParams.get('team') || '').trim();
    const forceICC = u.searchParams.get('refresh') === '1';
    if (!name) return sendJson(res,400,{ok:false,error:'name is required'});
    return sendJson(res,200,await resolvePlayerPhoto(name,team,{forceICC}));
  }
  if (u.pathname === '/api/icc-discover') {
    const name = String(u.searchParams.get('name') || '').trim();
    const team = String(u.searchParams.get('team') || '').trim();
    const force = u.searchParams.get('refresh') === '1';
    if (!name) return sendJson(res,400,{ok:false,error:'name is required'});
    const result = await discoverICCPlayer(name,team,{force});
    return sendJson(res,200,result || {ok:false,source:'icc-auto',url:null,name,team});
  }
  if (u.pathname === '/api/icc-cache') {
    return sendJson(res,200,{ok:true,autoDiscovery:ICC_AUTO_DISCOVERY,entries:iccPlayerMap});
  }
  if (u.pathname === '/api/state' || u.pathname === '/api/raw') {
    try {
      const feeds = feedsFor(key);
      const all = await Promise.allSettled([
        getJson(feeds.live,{cacheKey:`${key}:live`}),
        getJson(feeds.meta,{optional:true,cacheKey:`${key}:meta`}),
        getJson(feeds.scorecard,{optional:true,cacheKey:`${key}:score`})
      ]);
      if (all[0].status === 'rejected') throw all[0].reason;
      const live = unwrap(all[0].value), meta = all[1].status==='fulfilled' ? unwrap(all[1].value) : {value:{},stale:false,error:'meta failed'};
      const scoreRaw = all[2].status==='fulfilled' ? unwrap(all[2].value) : {value:[],stale:false,error:'scorecard failed'};
      const scorecard = mergeScorecard(key, scoreRaw.value || []);
      const ids = extractIds(scorecard, live.value || {});
      const players = await resolvePlayerNames(ids);
      const normalized = buildNormalized(scorecard, live.value || {}, meta.value || {}, players.map);
      const warnings = [live.error,meta.error,scoreRaw.error,players.warning].filter(Boolean);
      return sendJson(res,200,{ key,fetchedAt:Date.now(),pollMs:POLL_MS,live:live.value||{},meta:meta.value||{},scorecard,playerMap:players.map,playerMapStats:{requested:players.requested,resolved:players.resolved},normalized,stale:Boolean(live.stale||meta.stale||scoreRaw.stale),warnings });
    } catch (e) { return sendJson(res,502,{error:e.message,key}); }
  }
  serveStatic(u.pathname,res);
});

function selfTest() {
  const fixture = [
    {a:['EF.1.3.0.0'],b:['GA.1.3.0.0/29.92-102.28','2XL.0.0.0.0/28.11-96.93','5YW/41.23-75.55'],c:'V',d:'1/0(3',e:'0.0.0',p:['GA.1.3.2XL.0.0.1.3'],st:'1',x:'FL/FL'},
    {b:['O5/60.33-100.96','AK/49.45-91.08'],c:'O',st:'1',x:'O5/AK'}
  ];
  const live = {fo:'ODI',R:'50+0',speech_names:{O:'India',V:'West Indies'},B:'India opt to bowl'};
  const meta = [{team1:'India',team2:'West Indies',team1_fkey:'O',team2_fkey:'V',v:'Greenfield International Stadium'}];
  const map = {GA:'John Campbell','2XL':'Justin Greaves',EF:'Prasidh Krishna'};
  const iccFixture = '<a href="/rankings/60160/john-campbell">John Campbell</a><span>WI</span><a href="/rankings/3993/virat-kohli">Virat Kohli</a><span>IND</span>';
  const iccCandidates = parseICCSearchCandidates(iccFixture,'John Campbell','West Indies');
  if (!iccCandidates.length || iccCandidates[0].id !== '60160') process.exit(9);
  const n = buildNormalized(fixture,live,meta,map);
  console.log(JSON.stringify(n,null,2));
  if (n.batting !== 'West Indies' || n.batters[0]?.name !== 'John Campbell' || n.bowler?.name !== 'Prasidh Krishna' || n.score.score !== '1/0') process.exit(1);

  // Regression test: pair values can represent only the current partnership contribution.
  // The innings-total batter row must win, otherwise the striker card can show a lower,
  // mismatched score after a wicket/new partnership.
  const mismatchFixture = [{
    a:['EF.35.24.0.1'],
    b:['GA.62.60.8.2/29.92-102.28','2XL.5.7.1.0/28.11-96.93'],
    c:'V', d:'120/1(120', e:'1.4.0.1.2.0',
    p:['GA.5.7.2XL.5.7.10.14'], st:'1', x:'GA/2XL'
  }];
  const m = buildNormalized(mismatchFixture,live,meta,map);
  if (m.batters[0]?.runs !== 62 || m.batters[0]?.balls !== 60 || m.partnership.runs !== 10 || m.partnership.balls !== 14) process.exit(2);
  const odiLimit = inferInningsLimit({fo:'ODI',R:'12+0',over_reduced:0},{},{balls:168});
  const t20Limit = inferInningsLimit({fo:'T20',R:'50+0',over_reduced:0},{},{balls:60});
  const redLimit = inferInningsLimit({fo:'ODI',R:'22+0',over_reduced:1},{},{balls:60});
  if (odiLimit.balls !== 300 || t20Limit.balls !== 120 || redLimit.balls !== 132) process.exit(3);

  const rbLive = {
    ...live,
    j:'0/0(0.0',
    z:'7O3.6.4.0',
    rb:[
      {i:0,bt:'V',o:1,r:1,ts:'1/0',b:[
        {bf:'EF',d:1,t:0,u:'0'},{bf:'EF',d:2,t:0,u:'1'},{bf:'EF',d:3,t:1,u:'0'}]},
      {i:0,bt:'V',o:2,r:2,ts:'3/0',b:[
        {bf:'7O3',d:1,t:0,u:'1'},{bf:'7O3',d:2,t:0,u:'wd'}]}
    ]
  };
  const rbMap = {...map,'7O3':'Nitish Kumar Reddy'};
  const rbNorm = buildNormalized(fixture,rbLive,meta,rbMap);
  // Score must remain from the proven scorecard path (1/0), even though live.j is stale.
  if (rbNorm.score.score !== '1/0') process.exit(4);
  if (rbNorm.overHistory?.previous?.results?.join(',') !== '•,1,W') process.exit(5);
  if (rbNorm.overHistory?.current?.results?.join(',') !== '1,Wd') process.exit(6);
  if (rbNorm.bowler?.id !== '7O3' || rbNorm.bowler?.name !== 'Nitish Kumar Reddy') process.exit(7);
  console.log('SELF TEST PASSED');
}

if (process.argv.includes('--self-test')) selfTest();
else server.listen(PORT, () => console.log(`Cricket Live Studio v36 running at http://localhost:${PORT}  ->  control room: http://localhost:${PORT}/`));
