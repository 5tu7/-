// ============ إعدادات ============
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-me';   // كلمة سر المالك (غيّرها!)
const GOAL = 100000000;                                     // الهدف: 100 مليون مشاهدة + لايك
const TELEGRAM = 'lrlrrrl';                                 // يوزرك على تيليجرام
const AFK_GAIN = 100, AFK_SECONDS = 60;                     // كل دقيقة = +100 مشاهدة و +100 لايك
const DAILY_GAIN = 1000;                                    // الجائزة اليومية
const MAX_UPLOAD = 25 * 1024 * 1024;
// =================================
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const UP = path.join(__dirname, 'uploads'), DBF = path.join(__dirname, 'data.json');
fs.mkdirSync(UP, { recursive: true });

let db = { users: {}, photos: [], sessions: {}, views: 0, likes: 0, daily: {}, events: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch {}
let timer;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(DBF, JSON.stringify(db), () => {}), 400); };
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 1e6) => new Promise((ok, no) => {
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { no(new Error('big')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts))); req.on('error', no);
});
const readJSON = async req => { try { return JSON.parse((await readBody(req)).toString() || '{}'); } catch { return {}; } };
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
const newToken = name => { const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = name; save(); return t; };
const who = req => db.sessions[req.headers['x-token']] || null;
const dayKey = (d = Date.now()) => new Date(d).toISOString().slice(0, 10);
const event = (u, text) => { db.events.unshift({ u, text, ts: Date.now() }); db.events.length = Math.min(db.events.length, 30); };
function add(u, v, l) {                                   // يزيد العدادات الشخصية والعامة واليومية
  u.views += v; u.likes += l; db.views += v; db.likes += l;
  const d = db.daily[dayKey()] || (db.daily[dayKey()] = { views: 0, likes: 0 }); d.views += v; d.likes += l;
}

function publicState(me) {
  const u = me && db.users[me];
  const top = Object.entries(db.users).map(([n, x]) => ({ name: n, views: x.views, likes: x.likes })).sort((a, b) => b.likes - a.likes).slice(0, 10);
  const days = [...Array(7)].map((_, i) => { const k = dayKey(Date.now() - (6 - i) * 864e5); return { day: k.slice(5), ...(db.daily[k] || { views: 0, likes: 0 }) }; });
  return {
    goal: GOAL, telegram: TELEGRAM, afkGain: AFK_GAIN, afkSeconds: AFK_SECONDS, dailyGain: DAILY_GAIN,
    totalViews: db.views, totalLikes: db.likes, usersCount: Object.keys(db.users).length,
    photos: db.photos.map(p => ({ id: p.id, file: p.file, title: p.title, ts: p.ts, views: p.views, likes: p.likes,
      mine: u ? (u.photoLikes[p.id] || 0) : 0, fav: u ? u.fav.includes(p.id) : false, comments: (p.comments || []).slice(-30) })),
    top, days, events: db.events.slice(0, 12),
    me: u ? { name: me, views: u.views, likes: u.likes, dailyIn: Math.max(0, (u.lastDaily || 0) + 864e5 - Date.now()) } : null,
    admin: me === '__admin__'
  };
}

async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname, me = who(req), user = me && me !== '__admin__' ? db.users[me] : null;
  const needUser = () => { if (!user) { send(res, 401, { error: 'سجّل دخولك أولاً' }); return true; } };
  if (route === 'POST /api/register') {
    const { name = '', pass = '' } = await readJSON(req);
    if (!/^[\w\u0600-\u06FF.-]{2,20}$/.test(name)) return send(res, 400, { error: 'الاسم 2-20 حرف (حروف وأرقام فقط)' });
    if (pass.length < 4) return send(res, 400, { error: 'كلمة السر 4 أحرف على الأقل' });
    if (db.users[name] || name === '__admin__') return send(res, 400, { error: 'الاسم مستخدم' });
    const salt = crypto.randomBytes(8).toString('hex');
    db.users[name] = { salt, pass: hash(pass, salt), views: 0, likes: 0, photoLikes: {}, fav: [], lastAfk: 0, lastDaily: 0, created: Date.now() };
    event(name, 'انضم للموقع 👋'); return send(res, 200, { token: newToken(name) });
  }
  if (route === 'POST /api/login') {
    const { name = '', pass = '' } = await readJSON(req), u = db.users[name];
    if (!u || hash(pass, u.salt) !== u.pass) return send(res, 401, { error: 'بيانات الدخول خاطئة' });
    return send(res, 200, { token: newToken(name) });
  }
  if (route === 'POST /api/admin') {
    const { pass = '' } = await readJSON(req);
    if (pass !== ADMIN_PASS) return send(res, 401, { error: 'كلمة السر خاطئة' });
    return send(res, 200, { token: newToken('__admin__') });
  }
  if (route === 'GET /api/state') return send(res, 200, publicState(me));
  if (route === 'POST /api/view') {                      // كل دخول = مشاهدة، بلا حماية
    const { photoId } = await readJSON(req);
    if (user) add(user, 1, 0);
    const p = db.photos.find(x => x.id === photoId); if (p) p.views++;
    save(); return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/like') {                      // بلا حد ولا فحص IP
    if (needUser()) return;
    const { photoId, n = 1 } = await readJSON(req), p = db.photos.find(x => x.id === photoId);
    if (!p) return send(res, 404, { error: 'الصورة غير موجودة' });
    const k = Math.min(Math.max(parseInt(n) || 1, 1), 1000);
    add(user, 0, k); user.photoLikes[p.id] = (user.photoLikes[p.id] || 0) + k; p.likes += k;
    if (!db.events[0] || db.events[0].u !== me || Date.now() - db.events[0].ts > 5000) event(me, 'أعجبته صورة ❤️');
    save(); return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/afk') {                       // مكافأة الدقيقة
    if (needUser()) return;
    if (Date.now() - user.lastAfk < (AFK_SECONDS - 5) * 1000) return send(res, 429, { error: 'بدري شوي' });
    user.lastAfk = Date.now(); add(user, AFK_GAIN, AFK_GAIN); save(); return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/daily') {                     // الجائزة اليومية
    if (needUser()) return;
    if (Date.now() - user.lastDaily < 864e5) return send(res, 429, { error: 'استلمتها اليوم، ارجع بعد قليل' });
    user.lastDaily = Date.now(); add(user, DAILY_GAIN, DAILY_GAIN); event(me, 'استلم الجائزة اليومية 🎁'); save();
    return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/fav') {
    if (needUser()) return;
    const { photoId } = await readJSON(req), i = user.fav.indexOf(photoId);
    if (i > -1) user.fav.splice(i, 1); else user.fav.push(photoId);
    save(); return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/comment') {
    if (needUser()) return;
    const { photoId, text = '' } = await readJSON(req), p = db.photos.find(x => x.id === photoId), t = String(text).trim().slice(0, 200);
    if (!p || !t) return send(res, 400, { error: 'تعليق فارغ' });
    (p.comments = p.comments || []).push({ u: me, t, ts: Date.now() }); if (p.comments.length > 200) p.comments.shift();
    event(me, 'علّق على صورة 💬'); save(); return send(res, 200, publicState(me));
  }
  if (route === 'POST /api/upload') {
    if (me !== '__admin__') return send(res, 403, { error: 'للمالك فقط' });
    const ext = path.extname(decodeURIComponent(req.headers['x-filename'] || '')).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return send(res, 400, { error: 'نوع ملف غير مدعوم' });
    let buf; try { buf = await readBody(req, MAX_UPLOAD); } catch { return send(res, 413, { error: 'الملف كبير' }); }
    const id = crypto.randomBytes(6).toString('hex'), file = id + ext;
    fs.writeFileSync(path.join(UP, file), buf);
    db.photos.unshift({ id, file, title: decodeURIComponent(req.headers['x-title'] || '').slice(0, 80), ts: Date.now(), views: 0, likes: 0, comments: [] });
    event('المالك', 'نشر صورة جديدة 📸'); save(); return send(res, 200, publicState(me));
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/photo/')) {
    if (me !== '__admin__') return send(res, 403, { error: 'للمالك فقط' });
    const i = db.photos.findIndex(x => x.id === url.pathname.split('/').pop());
    if (i > -1) { fs.unlink(path.join(UP, db.photos[i].file), () => {}); db.photos.splice(i, 1); save(); }
    return send(res, 200, publicState(me));
  }
  if (route === 'GET /api/backup') {                     // نسخة احتياطية للمالك
    if (me !== '__admin__') return send(res, 403, { error: 'للمالك فقط' });
    const copy = { ...db, sessions: {}, users: Object.fromEntries(Object.entries(db.users).map(([n, u]) => [n, { ...u, pass: '', salt: '' }])) };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=backup.json' });
    return res.end(JSON.stringify(copy, null, 1));
  }
  send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const f = url.pathname.startsWith('/uploads/') ? path.join(UP, path.basename(url.pathname))
      : path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.basename(url.pathname));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); res.end(d);
    });
  } catch (e) { send(res, 500, { error: 'server error' }); }
}).listen(PORT, () => console.log(`الموقع يعمل: http://localhost:${PORT}  |  كلمة سر المالك: ${ADMIN_PASS}`));
