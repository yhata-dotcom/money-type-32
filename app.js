/* MONEY TYPE 32 — 画面と動き（v2）
 * 回答・名前・今の状況・FPメモはメモリ上にだけ持ち、「次の方へ」で消去する。
 * 外に出るのは2つだけ：
 *   1. QRで渡すURL … 結果を # 以降に入れる（# 以降はサーバーに送られない）
 *   2. 個別相談の申し込み … ご本人が同意して送信したときだけ、波多FP事務所の受付フォームへ送る
 *      （通信できないときは、この端末に一時保存し、つながったら自動で送る）
 */
'use strict';

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const N_Q = QUESTIONS.length;
const MEMO_MAX = 100, STEP_MAX = 30, NAME_MAX = 12;
const VERSION = 'v2';

const CONSULT_FORM = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSdm40_Asg6U6taINhawO4fp-rTKfsZSpU8hXMcgQ8JxktB6Gg/formResponse',
  entry: {
    name: 'entry.104425766', email: 'entry.1248065791', tel: 'entry.201938640', line: 'entry.53436487',
    method: 'entry.1615081305', time: 'entry.147701446', message: 'entry.68391219', type: 'entry.318407697',
    axes: 'entry.1283104842', powers: 'entry.1188607012', status: 'entry.1371066932', concerns: 'entry.173533569',
    memo: 'entry.1601253323', pair: 'entry.12728321', meta: 'entry.158139742',
  },
};

/* ---------- 状態 ---------- */
const newPerson = (name = '') => ({
  name, answers: new Array(N_Q).fill(null), status: new Array(STATUS.length).fill(null),
  memo: '', step: '', consultSent: false,
});
let S;
let timers = [];
function resetState() {
  timers.forEach(clearTimeout); timers = [];
  S = { mode: 'single', people: [newPerson()], p: 0, q: 0, concerns: new Set(), tab: 0, lock: false };
}
resetState();
let SHARED = null; // 来場者のスマホで開いた結果ページの内容

/* ---------- 判定 ---------- */
// 各軸の合計（-6〜+6）。プラスは a 側
function sumsOf(answers) {
  const s = [0, 0, 0, 0, 0];
  answers.forEach((v, i) => {
    if (v == null) return;
    const q = QUESTIONS[i];
    s[q.axis] += q.options[0].side === 'a' ? v : -v;
  });
  return s;
}
function typeOf(sums) {
  const sides = sums.map((s, i) => (s > 0 ? 'a' : s < 0 ? 'b' : TIE_SIDE[i]));
  const pctA = sums.map(s => Math.round(50 + (s / 6) * 50));
  const pct = sides.map((sd, i) => (sd === 'a' ? pctA[i] : 100 - pctA[i]));
  const codes = sides.map((sd, i) => AXES[i][sd].code);
  const baseIdx = BASES.findIndex(b => b.key === codes[0] + codes[1] + codes[2]);
  const subIdx = SUBS.findIndex(s => s.key === codes[3] + codes[4]);
  return { sums, sides, pctA, pct, codes, baseIdx, subIdx, base: BASES[baseIdx], sub: SUBS[subIdx],
           no: pad(baseIdx * 4 + subIdx + 1), catchCopy: CATCHES[baseIdx][subIdx] };
}
const statusObj = arr => Object.fromEntries(STATUS.map((it, i) => [it.key, arr[i]]));
const hasStatus = arr => arr.some(v => v != null);

function powersOf(t, statusArr) {
  const [N, P, Sd, L, R] = t.pctA;          // a側の割合：今・計画・安定・論理・自分で調べる
  const F = 100 - N, A = 100 - P, V = 100 - Sd, I = 100 - L, C = 100 - R;
  const v = {
    save: 0.5 * F + 0.35 * P + 0.15 * Sd,
    grow: 0.4 * V + 0.35 * F + 0.25 * L,
    protect: 0.45 * Sd + 0.35 * P + 0.2 * C,
    use: 0.5 * N + 0.25 * A + 0.25 * I,
    learn: 0.45 * L + 0.35 * R + 0.2 * F,
  };
  const st = statusObj(statusArr);
  if (st.emergency === 0) { v.protect += 12; v.save += 8; } else if (st.emergency === 1) v.protect -= 8;
  if (st.budget === 0) v.save += 10; else if (st.budget === 1) v.save -= 6;
  if (st.invest === 0) { v.grow += 14; v.learn += 6; } else if (st.invest === 1) v.learn += 6;
  if (st.insurance === 0) v.protect += 10; else if (st.insurance === 1) v.protect -= 4;
  return POWERS.map(p => Math.max(0, Math.min(100, Math.round(v[p.key]))));
}
const levelOf = v => Math.min(5, Math.max(1, Math.ceil(v / 20)));
function adviceFor(statusArr) {
  const st = statusObj(statusArr);
  return STATUS_ADVICE.filter(a => a.when(st)).slice(0, 3);
}

/* ---------- 共有URL（QR） ---------- */
const b64e = s => {
  let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64d = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
};
const encSums = sums => sums.map(s => String.fromCharCode(103 + s)).join('');          // -6..6 → a..m
const encStatus = arr => arr.map(v => (v == null ? '-' : String(v))).join('');
function shareURL(ctx) {
  const base = encodeURI(decodeURI(location.origin + location.pathname));
  let h = 'r=' + encSums(ctx.sums);
  if (hasStatus(ctx.status)) h += '&st=' + encStatus(ctx.status);
  if (ctx.name) h += '&n=' + b64e(ctx.name);
  if (ctx.memo) h += '&m=' + b64e(ctx.memo);
  if (ctx.step) h += '&s=' + b64e(ctx.step);
  return base + '#' + h;
}
function parseShared() {
  const h = location.hash.slice(1);
  if (!h.includes('r=')) return null;
  const q = new URLSearchParams(h);
  const r = q.get('r') || '';
  let sums;
  if (/^[a-m]{5}$/.test(r)) sums = r.split('').map(c => c.charCodeAt(0) - 103);
  else if (/^[0-3]{5}$/.test(r)) sums = r.split('').map(c => (+c * 2 - 3) * 2);   // 最初の版（2択）のQR
  else return null;
  const status = new Array(STATUS.length).fill(null);
  const st = q.get('st') || '';
  if (st.length === STATUS.length) st.split('').forEach((c, i) => {
    const v = +c; if (c !== '-' && Number.isInteger(v) && v < STATUS[i].options.length) status[i] = v;
  });
  const get = k => { try { return q.get(k) ? b64d(q.get(k)) : ''; } catch (e) { return ''; } };
  const name = get('n').slice(0, NAME_MAX);
  return { idx: -1, name, label: name ? name + 'さん' : 'あなた', sums, status, memo: get('m').slice(0, MEMO_MAX),
           step: get('s').slice(0, STEP_MAX), concerns: [], sent: false, booth: false };
}
function qrSVG(text) {
  const qr = qrcode(0, 'L'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 3; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" aria-label="診断結果のQRコード"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0f1b2d"/></svg>`;
}

/* ---------- 表示の共通部品 ---------- */
const dispName = i => {
  const n = S.people[i]?.name;
  if (n) return n + 'さん';
  return S.mode === 'duo' ? ['おひとり目', 'おふたり目'][i] : 'あなた';
};
function ctxOfPerson(i) {
  const P = S.people[i];
  return { idx: i, name: P.name, label: dispName(i), sums: sumsOf(P.answers), status: P.status, memo: P.memo, step: P.step,
           concerns: [...S.concerns].sort((a, b) => a - b).map(k => CONCERNS[k]), sent: P.consultSent, booth: true };
}
const ctxOf = idx => (idx < 0 ? SHARED : ctxOfPerson(idx));
function show(html, cls) {
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  window.scrollTo(0, 0);
}
const brandFooter = (cls = '') => `
  <footer class="brand ${cls}">
    <img src="assets/emblem.png" alt="" width="40" height="40">
    <div><b>波多FP事務所</b><span>お金のこと、もっと身近に</span></div>
  </footer>`;
const phrase = t => esc(t).replace(/([、。])/g, '$1<wbr>');
const li = arr => arr.map(t => `<li>${esc(t)}</li>`).join('');

/* ---------- スタート ---------- */
function renderStart() {
  const queued = loadQueue().length;
  show(`
    <div class="frame">
      <header class="start-head">
        <img class="start-emblem" src="assets/emblem.png" alt="波多FP事務所" width="88" height="88">
        <p class="overline">HATA FP OFFICE</p>
      </header>
      <h1 class="wordmark">
        <span class="wm-main">MONEY TYPE</span>
        <span class="wm-num"><i></i><b>32</b><i></i></span>
        <span class="wm-jp">お金の性格診断</span>
      </h1>
      <p class="start-lead">15の質問に5段階で答えるだけで、32タイプの中から<br>あなたの「お金の性格」がわかります。<br>お金の5つの力、相性のいいタイプ、将来の落とし穴も。</p>
      <div class="start-actions">
        <button class="btn btn-gold" data-act="start-single">ひとりで診断する</button>
        <button class="btn btn-line" data-act="start-duo">ふたりで診断する<small>パートナー・ご家族・ご友人と</small></button>
      </div>
      <p class="start-meta">所要時間 約4分<span>｜</span>回答内容は保存されません</p>
      ${queued ? `<p class="queue-note">未送信の相談希望が ${queued} 件あります（通信が戻ると自動で送信します）</p>` : ''}
      ${brandFooter('on-dark')}
    </div>`, 'dark start');
}

/* ---------- ふたりの呼び名 ---------- */
function renderNames() {
  show(`
    <div class="frame narrow">
      <p class="overline">FOR TWO</p>
      <h2 class="dark-title">おふたりの呼び名を<br>教えてください</h2>
      <p class="dark-lead">結果の画面に表示します。ニックネームでも、空欄のままでも大丈夫です。</p>
      <div class="name-fields">
        <label><span>おひとり目</span><input id="n1" maxlength="${NAME_MAX}" placeholder="例：ゆう" autocomplete="off" enterkeyhint="next"></label>
        <label><span>おふたり目</span><input id="n2" maxlength="${NAME_MAX}" placeholder="例：みき" autocomplete="off" enterkeyhint="done"></label>
      </div>
      <div class="start-actions">
        <button class="btn btn-gold" data-act="duo-begin">診断をはじめる</button>
        <button class="btn-text on-dark" data-act="home">‹ もどる</button>
      </div>
    </div>`, 'dark names');
}

/* ---------- 質問（5段階） ---------- */
function quizCard() {
  const P = S.people[S.p], q = QUESTIONS[S.q], cur = P.answers[S.q];
  return `
    <div class="qcard">
      <p class="qnum">${pad(S.q + 1)}</p>
      <h2 class="qtext">${esc(q.text).replace(/\n/g, '<br>')}</h2>
      <div class="stmts">
        ${q.options.map((o, i) => `
          <button class="stmt ${i ? 'b' : 'a'}${cur != null && (i ? cur < 0 : cur > 0) ? ' lean' : ''}" data-act="pick" data-v="${i ? -2 : 2}">
            <span class="ab">${'AB'[i]}</span><span class="ot">${esc(o.text)}</span>
          </button>`).join('')}
      </div>
      <div class="scale" role="radiogroup" aria-label="どちらに近いか">
        ${LIKERT.map(l => `
          <button class="dot s-${l.size} ${l.v > 0 ? 'ga' : l.v < 0 ? 'gb' : 'g0'}${cur === l.v ? ' sel' : ''}" data-act="pick" data-v="${l.v}" role="radio" aria-checked="${cur === l.v}">
            <i></i><span>${l.label}</span>
          </button>`).join('')}
      </div>
      <p class="qhint">A・Bのどちらに近いか、5段階で選んでください</p>
    </div>`;
}
function renderQuiz() {
  S.lock = false;
  const cur = $('.screen.quiz');
  const pct = ((S.q + 1) / N_Q) * 100;
  const who = S.mode === 'duo' ? `<span class="who">${esc(dispName(S.p))}</span>` : '<span class="who"></span>';
  if (cur && cur.dataset.p === String(S.p)) {
    $('.qcount b').textContent = pad(S.q + 1);
    $('.qprogress i').style.width = pct + '%';
    $('#qwrap').innerHTML = quizCard();
    return;
  }
  show(`
    <header class="qbar">
      <button class="btn-text" data-act="back">‹ 前へ</button>
      <p class="qcount">QUESTION <b>${pad(S.q + 1)}</b> / ${N_Q}</p>
      ${who}
    </header>
    <div class="qprogress"><i style="width:${pct}%"></i></div>
    <main id="qwrap">${quizCard()}</main>`, 'light quiz');
  $('.screen.quiz').dataset.p = String(S.p);
}
function pick(v, btn) {
  if (S.lock) return;
  S.lock = true;
  S.people[S.p].answers[S.q] = v;
  const card = btn.closest('.qcard');
  card.querySelectorAll('.dot, .stmt').forEach(b => b.classList.remove('sel', 'lean', 'picked'));
  const dot = card.querySelector(`.dot[data-v="${v}"]`);
  dot.classList.add('sel', 'picked');
  if (v !== 0) card.querySelector(v > 0 ? '.stmt.a' : '.stmt.b').classList.add('lean');
  timers.push(setTimeout(nextQuestion, 420));
}
function nextQuestion() {
  if (S.q < N_Q - 1) { S.q++; return renderQuiz(); }
  renderStatus();
}
function prevQuestion() {
  if (S.q > 0) { S.q--; return renderQuiz(); }
  if (S.p === 1) return renderHandoff();
  renderStart();
}

/* ---------- 今の状況（任意） ---------- */
function renderStatus() {
  const P = S.people[S.p];
  const whose = S.mode === 'duo' ? esc(dispName(S.p)) + 'の' : '';
  show(`
    <header class="qbar">
      <button class="btn-text" data-act="status-back">‹ 前へ</button>
      <p class="qcount">ABOUT YOU</p>
      ${S.mode === 'duo' ? `<span class="who">${esc(dispName(S.p))}</span>` : '<span class="who"></span>'}
    </header>
    <div class="qprogress"><i style="width:100%"></i></div>
    <main class="status">
      <h2 class="qtext">${whose}今の状況を<br>教えてください</h2>
      <p class="qhint">すべて任意です。答えたくない項目は空欄のままで大丈夫です。<br>結果の「お金の5つの力」とアドバイスに反映します。</p>
      <div class="st-list">
        ${STATUS.map((it, i) => `
          <div class="st-row">
            <p class="st-label">${esc(it.label)}</p>
            <div class="st-opts">${it.options.map((o, j) => `<button class="chip${P.status[i] === j ? ' on' : ''}" data-act="status" data-i="${i}" data-j="${j}">${esc(o)}</button>`).join('')}</div>
          </div>`).join('')}
      </div>
      <button class="btn btn-navy" data-act="status-next">次へ</button>
    </main>`, 'light status-screen');
}
function statusNext() {
  if (S.mode === 'duo' && S.p === 0) return renderHandoff();
  renderConcerns();
}

/* ---------- ふたり：交代 ---------- */
function renderHandoff() {
  show(`
    <div class="frame narrow">
      <p class="overline">NEXT</p>
      <h2 class="dark-title">${esc(dispName(0))}、<br>おつかれさまでした</h2>
      <p class="dark-lead">次は${esc(dispName(1))}の番です。<br>iPadをお渡しください。</p>
      <div class="start-actions">
        <button class="btn btn-gold" data-act="handoff-go">${esc(dispName(1))}の診断をはじめる</button>
        <button class="btn-text on-dark" data-act="handoff-back">‹ 前の画面にもどる</button>
      </div>
    </div>`, 'dark handoff');
}

/* ---------- いま気になっていること ---------- */
function renderConcerns() {
  show(`
    <header class="qbar">
      <button class="btn-text" data-act="concerns-back">‹ 前へ</button>
      <p class="qcount">LAST STEP</p><span class="who"></span>
    </header>
    <div class="qprogress"><i style="width:100%"></i></div>
    <main class="concerns">
      <h2 class="qtext">最後に、いま気になっている<br>お金のことはありますか？</h2>
      <p class="qhint">いくつでも選べます。FPとお話しするときのヒントにします。</p>
      <div class="chips">
        ${CONCERNS.map((c, i) => `<button class="chip${S.concerns.has(i) ? ' on' : ''}" data-act="concern" data-i="${i}">${esc(c)}</button>`).join('')}
      </div>
      <button class="btn btn-navy" data-act="to-result">診断結果を見る</button>
    </main>`, 'light concerns-screen');
}

/* ---------- 演出 ---------- */
function renderReveal() {
  show(`
    <div class="reveal">
      <svg class="spinner" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54"/><circle cx="60" cy="60" r="44"/>
      </svg>
      <p class="reveal-text" id="rt">回答を集計しています</p>
    </div>`, 'dark reveal-screen');
  const msgs = ['5つの軸と、お金の5つの力を読み解いています', S.mode === 'duo' ? 'おふたりのタイプが見つかりました' : 'あなたのタイプが見つかりました'];
  timers.push(setTimeout(() => { const el = $('#rt'); if (el) el.textContent = msgs[0]; }, 1000));
  timers.push(setTimeout(() => { const el = $('#rt'); if (el) el.textContent = msgs[1]; }, 2100));
  timers.push(setTimeout(() => { S.tab = 0; renderResult(true); }, 3000));
}

/* ---------- 結果の部品 ---------- */
function axisRows(t) {
  return AXES.map((ax, i) => {
    const pos = Math.max(6, Math.min(94, 50 - (t.sums[i] / 6) * 44));   // a 側が左
    const win = t.sides[i], bal = t.sums[i] === 0;
    const pctTxt = bal ? '半々' : t.pct[i] + '%';
    return `
      <div class="axis">
        <p class="axis-label"><span>${ax.en}</span>${ax.label}${bal ? '<em class="bal">バランス型</em>' : ''}</p>
        <div class="axis-line">
          <span class="side${win === 'a' ? ' win' : ''}">${ax.a.name}${win === 'a' ? `<b>${pctTxt}</b>` : ''}</span>
          <span class="track"><i style="left:${pos}%"></i></span>
          <span class="side r${win === 'b' ? ' win' : ''}">${ax.b.name}${win === 'b' ? `<b>${pctTxt}</b>` : ''}</span>
        </div>
      </div>`;
  }).join('');
}
function radarSVG(vals) {
  const cx = 170, cy = 150, R = 100, n = POWERS.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const fmt = p => p.map(v => v.toFixed(1)).join(',');
  const poly = r => POWERS.map((_, i) => fmt(pt(i, r))).join(' ');
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map(f => `<polygon class="rg" points="${poly(R * f)}"/>`).join('');
  const spokes = POWERS.map((_, i) => { const [x, y] = pt(i, R); return `<line class="sp" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const dataPts = vals.map((v, i) => pt(i, R * (0.15 + (0.85 * v) / 100)));
  const labels = POWERS.map((p, i) => {
    const [x, y] = pt(i, R + 20);
    const anchor = Math.abs(x - cx) < 5 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="${anchor}">${p.name}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="0 0 340 290" role="img" aria-label="お金の5つの力のレーダーチャート">
    ${rings}${spokes}
    <g class="shape-g"><polygon class="shape" points="${dataPts.map(fmt).join(' ')}"/>
    ${dataPts.map(([x, y]) => `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>`).join('')}</g>
    ${labels}
  </svg>`;
}
function powersBlock(t, statusArr) {
  const vals = powersOf(t, statusArr);
  const top = vals.indexOf(Math.max(...vals)), low = vals.indexOf(Math.min(...vals));
  const lv = vals.map(levelOf);
  return `
    <section class="r-sec powers">
      <h2 class="sec-h"><span>FIVE POWERS</span>お金の5つの力</h2>
      <div class="pw-wrap">
        <div class="pw-chart">${radarSVG(vals)}</div>
        <ul class="pw-list">
          ${POWERS.map((p, i) => `
            <li class="${i === top ? 'top' : ''}">
              <div><b>${p.name}</b><small>${p.desc}</small></div>
              <span class="lv" aria-label="5段階中 ${lv[i]}">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= lv[i] ? 'on' : ''}"></i>`).join('')}</span>
            </li>`).join('')}
        </ul>
      </div>
      ${top !== low ? `
        <div class="pw-notes">
          <p><span>いちばんの強み</span>「${POWERS[top].name}」── ${esc(POWERS[top].desc)}。</p>
          <p><span>伸ばすと心強い力</span>「${POWERS[low].name}」── ${esc(POWERS[low].low)}</p>
        </div>` : ''}
      <p class="pw-foot">※5つの軸の回答${hasStatus(statusArr) ? 'と今の状況' : ''}から算出した目安です。</p>
    </section>`;
}
function compatBlock(t) {
  const c = COMPAT[t.baseIdx];
  const card = (bi, label, text, cls) => `
    <div class="cp ${cls}">
      <div class="cp-em">${emblemSVG(bi, 0, { ring: false, glyphs: false })}</div>
      <div><p class="cp-label">${label}</p><p class="cp-name">${esc(BASES[bi].name)}</p><p class="cp-text">${esc(text)}</p></div>
    </div>`;
  return `
    <section class="r-sec compat">
      <h2 class="sec-h"><span>COMPATIBILITY</span>相性のいいタイプ・ぶつかりやすいタイプ</h2>
      <div class="cp-row">
        ${card(c.best, '補い合える相手', c.bestText, 'good')}
        ${card(c.clash, 'ぶつかりやすいけれど、学びの多い相手', c.clashText, 'clash')}
      </div>
    </section>`;
}
function adviceBlock(statusArr) {
  const items = adviceFor(statusArr);
  if (!items.length) return '';
  return `
    <section class="r-sec advice">
      <h2 class="sec-h"><span>FOR YOU NOW</span>今のあなたへのアドバイス</h2>
      <div class="adv-list">${items.map((a, i) => `<div class="adv"><span class="adv-no">${pad(i + 1)}</span><div><b>${esc(a.title)}</b><p>${esc(a.text)}</p></div></div>`).join('')}</div>
    </section>`;
}
function consultBlock(ctx) {
  return `
    <section class="r-consult" id="consult-${ctx.idx}">
      <p class="label">PERSONAL CONSULTATION</p>
      <h2>個別に相談してみたい方へ</h2>
      <p>30分の個別相談を、後日あらためてご利用いただけます。<br>${esc(CONSULT_NOTE)}</p>
      ${ctx.sent
        ? '<p class="sent">✓ 個別相談のご希望を受け付けました。後日、波多FP事務所からご連絡します。</p>'
        : `<button class="btn btn-gold" data-act="consult" data-idx="${ctx.idx}">個別相談を希望する</button>`}
    </section>`;
}

/* ---------- 結果（本文） ---------- */
function resultBody(ctx, animate) {
  const t = typeOf(ctx.sums), { base, sub } = t;
  const memoBlock = (ctx.memo || ctx.step) ? `
    <section class="r-memo">
      <p class="label">FPからのひとこと</p>
      ${ctx.memo ? `<p class="memo-text">${esc(ctx.memo)}</p>` : ''}
      ${ctx.step ? `<p class="memo-step"><span>今日の一歩</span>${esc(ctx.step)}</p>` : ''}
      <p class="memo-sign">波多FP事務所</p>
    </section>` : '';
  const concernChips = ctx.concerns.length
    ? `<p class="talk-sub">いま気になっていること</p><div class="chips static">${ctx.concerns.map(c => `<span class="chip on">${esc(c)}</span>`).join('')}</div>` : '';
  return `
    <article class="result">
      <header class="r-hero">
        <div class="r-emblem">${emblemSVG(t.baseIdx, t.subIdx, { animate })}</div>
        <div class="r-title">
          <p class="r-for">${esc(ctx.label)}のお金の性格は</p>
          <p class="r-no">TYPE ${t.no} <span>/ 32</span></p>
          <h1 class="r-name">${esc(base.name)}</h1>
          <p class="r-subname">${esc(sub.name)}</p>
          <p class="r-en">${esc(base.en)} — ${esc(sub.en)}</p>
          <p class="r-catch">${phrase(t.catchCopy)}</p>
        </div>
      </header>

      <section class="r-card r-axes">
        <h2 class="sec-h"><span>FIVE AXES</span>5つの軸で見るあなた</h2>
        ${axisRows(t)}
      </section>

      <section class="r-sec">
        <h2 class="sec-h"><span>PERSONALITY</span>お金の性格</h2>
        <p class="lead-tagline">${phrase(base.tagline)}</p>
        <p>${esc(base.desc)}</p>
        <p>${esc(sub.desc)}</p>
      </section>

      ${powersBlock(t, ctx.status)}

      <div class="r-cols">
        <section class="r-sec">
          <h2 class="sec-h"><span>STRENGTHS</span>あなたの強み</h2>
          <ul class="ls">${li([...base.strengths, sub.strength])}</ul>
        </section>
        <section class="r-sec">
          <h2 class="sec-h"><span>FUTURE RISKS</span>将来陥りがちなお金のリスク</h2>
          <ul class="ls risk">${li([...base.risks, sub.caution])}</ul>
        </section>
      </div>

      <section class="r-sec">
        <h2 class="sec-h"><span>YOUR WAY</span>相性のよい資産づくりの進め方</h2>
        <ol class="ls num">${li(base.style)}</ol>
        <p class="tip"><span>情報との付き合い方</span>${esc(sub.tip)}</p>
      </section>

      ${adviceBlock(ctx.status)}

      ${compatBlock(t)}

      <section class="r-point">
        <p class="label">FPからのワンポイント</p>
        <p>${esc(base.onePoint)}</p>
      </section>

      ${memoBlock}

      <section class="r-sec talk">
        <h2 class="sec-h"><span>LET'S TALK</span>${ctx.booth ? 'FPと話してみたいテーマ' : 'FPに相談してみたいテーマ'}</h2>
        ${concernChips}
        <ul class="ls">${li(base.talk)}</ul>
      </section>

      ${consultBlock(ctx)}

      <p class="disclaimer">※${esc(DISCLAIMER)}</p>
    </article>`;
}

/* ---------- ふたりの相性 ---------- */
function pairSummary() {
  const [t1, t2] = S.people.map(P => typeOf(sumsOf(P.answers)));
  const same = t1.sides.filter((s, i) => s === t2.sides[i]).length;
  return { t1, t2, same, sum: PAIR_SUMMARY.find(p => same >= p.min) };
}
function pairBody(animate) {
  const { t1, t2, same, sum } = pairSummary();
  const fig = (t, i) => `
    <figure class="p-fig">
      <div class="p-emblem">${emblemSVG(t.baseIdx, t.subIdx, { animate, ring: false })}</div>
      <figcaption><b>${esc(dispName(i))}</b><span class="p-type">${esc(t.base.name)}</span><small>${esc(t.sub.name)}／TYPE ${t.no}</small></figcaption>
    </figure>`;
  const rows = AXES.map((ax, i) => {
    const s1 = t1.sides[i], s2 = t2.sides[i];
    const txt = s1 === s2 ? (s1 === 'a' ? PAIR_AXIS[i].sameA : PAIR_AXIS[i].sameB) : PAIR_AXIS[i].diff;
    return `
      <div class="p-axis">
        <p class="axis-label"><span>${ax.en}</span>${ax.label}<em class="${s1 === s2 ? 'same' : 'diff'}">${s1 === s2 ? '同じ' : 'ちがう'}</em></p>
        <p class="p-sides"><span><small>${esc(dispName(0))}</small>${ax[s1].name} ${t1.pct[i]}%</span><span><small>${esc(dispName(1))}</small>${ax[s2].name} ${t2.pct[i]}%</span></p>
        <p class="p-text">${esc(txt)}</p>
      </div>`;
  }).join('');
  return `
    <article class="result pair">
      <header class="p-hero">
        <div class="p-two">${fig(t1, 0)}<span class="p-amp">&amp;</span>${fig(t2, 1)}</div>
        <p class="r-no">COMPATIBILITY</p>
        <h1 class="r-name">${esc(sum.title)}</h1>
        <p class="p-count">5つの軸のうち <b>${same}</b> つが一致</p>
        <p class="p-lead">${esc(sum.text)}</p>
      </header>
      <section class="r-card">${rows}</section>
      <section class="r-sec">
        <h2 class="sec-h"><span>LET'S TALK</span>ふたりで話してみたいこと</h2>
        <ol class="ls num">${li(PAIR_TALK)}</ol>
        <p class="tip"><span>ご相談いただけること</span>${esc(PAIR_NOTE)}</p>
      </section>
      <p class="disclaimer">※${esc(DISCLAIMER)}</p>
    </article>`;
}

/* ---------- 結果画面（iPad） ---------- */
function renderResult(animate = false) {
  const duo = S.mode === 'duo', personTab = S.tab !== 2;
  const tabs = duo ? `
    <nav class="tabs">
      ${[0, 1].map(i => `<button class="tab${S.tab === i ? ' on' : ''}" data-act="tab" data-tab="${i}">${esc(dispName(i))}</button>`).join('')}
      <button class="tab${S.tab === 2 ? ' on' : ''}" data-act="tab" data-tab="2">ふたりの相性</button>
    </nav>` : '';
  show(`
    <div class="sticky-head">
    <header class="topbar">
      <p class="tb-mark">MONEY TYPE <b>32</b></p>
      <div class="tb-actions">
        <button class="tb-btn" data-act="qr">QRで持ち帰る</button>
        ${personTab ? '<button class="tb-btn" data-act="memo">FPメモ</button>' : ''}
        ${personTab ? `<button class="tb-btn" data-act="consult" data-idx="${S.tab}">個別相談</button>` : ''}
        <button class="tb-btn strong" data-act="reset">次の方へ</button>
      </div>
    </header>
    ${tabs}
    </div>
    <div id="rbody">${resultContent(animate)}</div>
    ${brandFooter()}`, 'light result-screen' + (duo ? ' duo' : ''));
}
function resultContent(animate) {
  if (S.tab === 2) return pairBody(animate);
  return resultBody(ctxOfPerson(S.tab), animate);
}
function refreshResult() {
  if (SHARED) { const keep = window.scrollY; renderShared(SHARED, false); window.scrollTo(0, keep); return; }
  const el = $('#rbody'); if (el) el.innerHTML = resultContent(false);
}

/* ---------- モーダル ---------- */
function openModal(html, cls = '') {
  closeModal();
  const el = document.createElement('div');
  el.className = 'modal-back';
  el.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) closeModal(); });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  return el;
}
function closeModal() { document.querySelectorAll('.modal-back').forEach(m => m.remove()); }

function openQR() {
  const idx = S.tab === 2 ? [0, 1] : [S.tab];
  const block = i => {
    const P = S.people[i];
    return `
      <figure class="qr-fig">
        ${qrSVG(shareURL(ctxOfPerson(i)))}
        <figcaption>${idx.length > 1 ? `<b>${esc(dispName(i))}</b>` : ''}<span>FPからのひとこと：${P.memo || P.step ? 'あり' : 'なし'}</span></figcaption>
      </figure>`;
  };
  openModal(`
    <p class="m-over">TAKE IT HOME</p>
    <h3 class="m-title">結果をスマホで持ち帰る</h3>
    <div class="qr-row">${idx.map(block).join('')}</div>
    <p class="m-text">スマートフォンのカメラで読み取ると、診断結果のページが開きます。<br>スクリーンショットやブックマークで保存してください。</p>
    <p class="m-note">回答の内容は、このiPadにもインターネット上にも保存されません。</p>
    <button class="btn btn-navy" data-act="close-modal">閉じる</button>`, 'qr-modal');
}

function openMemo() {
  const P = S.people[S.tab];
  const m = openModal(`
    <p class="m-over">FP MEMO</p>
    <h3 class="m-title">FPメモ<small>${esc(dispName(S.tab))}の結果に表示され、QRと相談希望にも入ります</small></h3>
    <label class="f-label" for="memo">FPからのひとこと<span class="cnt"><b id="mc">0</b> / ${MEMO_MAX}</span></label>
    <textarea id="memo" maxlength="${MEMO_MAX}" rows="3" placeholder="例：まずは生活費の3〜6か月分を確保しましょう。">${esc(P.memo)}</textarea>
    <div class="phr">${MEMO_PHRASES.map(t => `<button data-act="phrase" data-target="memo" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="f-label" for="step">今日の一歩<span class="cnt"><b id="sc">0</b> / ${STEP_MAX}</span></label>
    <input id="step" maxlength="${STEP_MAX}" value="${esc(P.step)}" placeholder="例：今月の収支を書き出す" autocomplete="off">
    <div class="phr">${STEP_PHRASES.map(t => `<button data-act="phrase" data-target="step" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="m-row">
      <button class="btn-text" data-act="memo-clear">すべて消す</button>
      <button class="btn btn-navy" data-act="memo-save">結果に反映する</button>
    </div>`, 'memo-modal form-modal');
  const upd = () => { $('#mc').textContent = $('#memo').value.length; $('#sc').textContent = $('#step').value.length; };
  m.addEventListener('input', upd); upd();
}
function insertPhrase(target, text) {
  const el = $('#' + target);
  if (target === 'memo') {
    const v = el.value.trim();
    el.value = (v ? v + (/[。！？]$/.test(v) ? '' : '。') + text : text).slice(0, MEMO_MAX);
  } else {
    el.value = text.slice(0, STEP_MAX);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function saveMemo() {
  const P = S.people[S.tab];
  P.memo = $('#memo').value.trim().slice(0, MEMO_MAX);
  P.step = $('#step').value.trim().slice(0, STEP_MAX);
  closeModal();
  refreshResult();
}

function confirmReset() {
  openModal(`
    <p class="m-over">NEXT GUEST</p>
    <h3 class="m-title">次の方へ進みますか？</h3>
    <p class="m-text">${S.mode === 'duo' ? 'おふたり' : 'この方'}の回答・診断結果・FPメモをすべて消去して、はじめの画面にもどります。</p>
    <div class="m-row">
      <button class="btn btn-line dark-text" data-act="close-modal">キャンセル</button>
      <button class="btn btn-navy" data-act="reset-go">消去して次の方へ</button>
    </div>`, 'confirm-modal');
}

/* ---------- 個別相談の申し込み ---------- */
let CF = null; // 入力中の申し込み
function openConsult(idx) {
  const ctx = ctxOf(idx);
  CF = { idx, method: null, who: null, times: new Set() };
  const chipRow = (group, list, multi) => `<div class="chips left" data-group="${group}">${list.map((v, i) =>
    `<button class="chip" data-act="cf-chip" data-group="${group}" data-i="${i}"${multi ? ' data-multi="1"' : ''}>${esc(v)}</button>`).join('')}</div>`;
  openModal(`
    <p class="m-over">PERSONAL CONSULTATION</p>
    <h3 class="m-title">個別相談を希望する<small>30分の個別相談（後日）。${esc(CONSULT_NOTE)}</small></h3>
    <div class="cf">
      <label class="f-label" for="cf-name">お名前<em>必須</em></label>
      <input id="cf-name" maxlength="40" value="${esc(ctx.name)}" autocomplete="name" placeholder="例：山田 ひかる">
      <p class="f-group">ご連絡先<em>いずれか1つ以上</em></p>
      <label class="f-label" for="cf-email">メールアドレス<small>入力すると、受付の確認メールが届きます</small></label>
      <input id="cf-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" maxlength="100" placeholder="example@mail.com">
      <label class="f-label" for="cf-tel">電話番号</label>
      <input id="cf-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="090-1234-5678">
      <label class="f-label" for="cf-line">LINE ID</label>
      <input id="cf-line" maxlength="40" autocapitalize="off" autocomplete="off" placeholder="LINEのID">
      <p class="f-label">ご希望の相談方法</p>
      ${chipRow('method', CONSULT_METHODS, false)}
      ${S.mode === 'duo' && idx >= 0 ? `<p class="f-label">ご相談される人数</p>${chipRow('who', CONSULT_WHO, false)}` : ''}
      <p class="f-label">ご希望の時間帯<small>いくつでも</small></p>
      ${chipRow('time', CONSULT_TIMES, true)}
      <label class="f-label" for="cf-msg">ご相談したいこと<small>任意</small></label>
      <textarea id="cf-msg" maxlength="300" rows="3" placeholder="例：NISAの始め方、住宅購入のことなど"></textarea>
      <p class="cf-what">送信する内容：お名前・ご連絡先・ご希望と、今回の診断結果（タイプ・5つの軸・お金の5つの力・今の状況・気になっていること・FPメモ）</p>
      <label class="consent"><input type="checkbox" id="cf-agree"><span>${esc(PRIVACY_NOTE)}<b>上記に同意します。</b></span></label>
      <p class="cf-err" id="cf-err" role="alert"></p>
      <div class="m-row">
        <button class="btn-text" data-act="close-modal">キャンセル</button>
        <button class="btn btn-navy" data-act="consult-send" id="cf-send">送信する</button>
      </div>
    </div>`, 'form-modal consult-modal');
}
function cfChip(b) {
  const g = b.dataset.group, i = +b.dataset.i;
  if (b.dataset.multi) {
    CF.times.has(i) ? CF.times.delete(i) : CF.times.add(i);
    b.classList.toggle('on');
  } else {
    CF[g] = CF[g] === i ? null : i;
    b.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.i === CF[g]));
  }
}
function buildConsultFields(ctx, form) {
  const t = typeOf(ctx.sums), pw = powersOf(t, ctx.status), E = CONSULT_FORM.entry;
  const fields = {
    [E.name]: form.name, [E.email]: form.email, [E.tel]: form.tel, [E.line]: form.line,
    [E.method]: [form.method, form.who].filter(Boolean).join(' ／ '),
    [E.time]: form.times.join('、'),
    [E.message]: form.message,
    [E.type]: `TYPE ${t.no} ${t.base.name}・${t.sub.name}`,
    [E.axes]: AXES.map((ax, i) => `${ax.label}：${ax[t.sides[i]].name} ${t.sums[i] === 0 ? '（半々）' : t.pct[i] + '%'}`).join('\n'),
    [E.powers]: POWERS.map((p, i) => `${p.name} ${levelOf(pw[i])}/5`).join('\n'),
    [E.status]: STATUS.map((it, i) => (ctx.status[i] != null ? `${it.label}：${it.options[ctx.status[i]]}` : null)).filter(Boolean).join('\n') || '（未回答）',
    [E.concerns]: ctx.concerns.join('、'),
    [E.memo]: [ctx.memo, ctx.step ? '今日の一歩：' + ctx.step : ''].filter(Boolean).join('\n'),
    [E.pair]: '',
    [E.meta]: `${ctx.booth ? 'ブースのiPad' : 'スマホ（結果ページ）'} ／ ${new Date().toLocaleString('ja-JP')} ／ ${VERSION}`,
  };
  if (ctx.booth && S.mode === 'duo') {
    const { t1, t2, same, sum } = pairSummary();
    fields[E.pair] = `${dispName(0)}：TYPE ${t1.no} ${t1.base.name}・${t1.sub.name}\n${dispName(1)}：TYPE ${t2.no} ${t2.base.name}・${t2.sub.name}\n${sum.title}（5つの軸のうち${same}つが一致）`;
  }
  return fields;
}
async function sendConsult() {
  const val = id => $(id).value.trim();
  const form = {
    name: val('#cf-name'), email: val('#cf-email'), tel: val('#cf-tel'), line: val('#cf-line'), message: val('#cf-msg'),
    method: CF.method != null ? CONSULT_METHODS[CF.method] : '', who: CF.who != null ? CONSULT_WHO[CF.who] : '',
    times: [...CF.times].sort().map(i => CONSULT_TIMES[i]),
  };
  const err = msg => { $('#cf-err').textContent = msg; $('#cf-err').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  if (!form.name) return err('お名前を入力してください。');
  if (!form.email && !form.tel && !form.line) return err('メールアドレス・電話番号・LINE IDのいずれかを入力してください。');
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return err('メールアドレスの形をご確認ください。');
  if (form.tel && !/^[0-9０-９+\-－() ]{9,}$/.test(form.tel)) return err('電話番号の形をご確認ください。');
  if (!$('#cf-agree').checked) return err('個人情報の取り扱いへの同意にチェックを入れてください。');

  const ctx = ctxOf(CF.idx);
  const fields = buildConsultFields(ctx, form);
  const btn = $('#cf-send'); btn.disabled = true; btn.textContent = '送信中…';
  let queued = false;
  try { await postForm(fields); } catch (e) { enqueue(fields); queued = true; }
  if (CF.idx < 0) SHARED.sent = true; else S.people[CF.idx].consultSent = true;
  openModal(`
    <p class="m-over">THANK YOU</p>
    <h3 class="m-title">個別相談のご希望を<br>受け付けました</h3>
    <p class="m-text">日程の調整のため、後日、波多FP事務所からご連絡します。${form.email ? '<br>入力いただいたメールアドレスに、受付の確認メールをお送りします。' : ''}</p>
    <p class="m-note">${esc(CONSULT_NOTE)}${queued ? '<br>（通信が不安定なため、つながりしだい自動で送信します）' : ''}</p>
    <button class="btn btn-navy" data-act="close-modal">閉じる</button>`, 'confirm-modal');
  refreshResult();
}

/* 送信と、通信できなかったときの一時保存 */
const QKEY = 'mt32-consult-queue';
function loadQueue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
function saveQueue(q) { try { q.length ? localStorage.setItem(QKEY, JSON.stringify(q)) : localStorage.removeItem(QKEY); } catch (e) { /* 保存できない環境 */ } }
function enqueue(fields) { const q = loadQueue(); q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), fields }); saveQueue(q); }
async function postForm(fields) {
  if (navigator.onLine === false) throw new Error('offline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    await fetch(CONSULT_FORM.url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(fields), signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}
let flushing = false;
async function flushQueue() {
  if (flushing) return;
  const snapshot = loadQueue();
  if (!snapshot.length) return;
  flushing = true;
  const failed = [];
  for (const item of snapshot) { try { await postForm(item.fields); } catch (e) { failed.push(item.id); } }
  const ids = new Set(snapshot.map(x => x.id));
  saveQueue(loadQueue().filter(x => !ids.has(x.id) || failed.includes(x.id)));
  flushing = false;
  const note = $('.queue-note');
  if (note) { const n = loadQueue().length; n ? (note.textContent = `未送信の相談希望が ${n} 件あります（通信が戻ると自動で送信します）`) : note.remove(); }
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 60000);

/* ---------- 共有ページ（来場者のスマホ） ---------- */
function renderShared(d, animate = true) {
  SHARED = d;
  const t = typeOf(d.sums);
  document.title = `${t.base.name}｜MONEY TYPE 32`;
  show(`
    <header class="share-head">
      <p class="tb-mark">MONEY TYPE <b>32</b></p>
      <p class="share-sub">お金の性格診断 ・ 診断結果</p>
    </header>
    ${resultBody(d, animate)}
    <div class="share-again"><a class="btn btn-line dark-text" href="./">もう一度診断する</a></div>
    ${brandFooter()}`, 'light result-screen shared');
}

/* ---------- 操作 ---------- */
app.addEventListener('click', handle);
document.body.addEventListener('click', e => { if (e.target.closest('.modal-back')) handle(e); });
function handle(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  keepAwake();
  switch (b.dataset.act) {
    case 'home': resetState(); renderStart(); break;
    case 'start-single': resetState(); renderQuiz(); break;
    case 'start-duo': resetState(); renderNames(); break;
    case 'duo-begin': {
      const n1 = $('#n1').value.trim().slice(0, NAME_MAX), n2 = $('#n2').value.trim().slice(0, NAME_MAX);
      resetState(); S.mode = 'duo'; S.people = [newPerson(n1), newPerson(n2)];
      document.activeElement?.blur(); renderQuiz(); break;
    }
    case 'pick': pick(+b.dataset.v, b); break;
    case 'back': prevQuestion(); break;
    case 'status': {
      const i = +b.dataset.i, j = +b.dataset.j, P = S.people[S.p];
      P.status[i] = P.status[i] === j ? null : j;
      b.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.j === P.status[i]));
      break;
    }
    case 'status-back': S.q = N_Q - 1; renderQuiz(); break;
    case 'status-next': statusNext(); break;
    case 'handoff-go': S.p = 1; S.q = 0; renderQuiz(); break;
    case 'handoff-back': S.p = 0; renderStatus(); break;
    case 'concern': {
      const i = +b.dataset.i;
      S.concerns.has(i) ? S.concerns.delete(i) : S.concerns.add(i);
      b.classList.toggle('on'); break;
    }
    case 'concerns-back': S.p = S.people.length - 1; renderStatus(); break;
    case 'to-result': renderReveal(); break;
    case 'tab': S.tab = +b.dataset.tab; renderResult(true); break;
    case 'qr': openQR(); break;
    case 'memo': openMemo(); break;
    case 'phrase': insertPhrase(b.dataset.target, b.dataset.text); break;
    case 'memo-clear': $('#memo').value = ''; $('#step').value = ''; $('#memo').dispatchEvent(new Event('input', { bubbles: true })); break;
    case 'memo-save': saveMemo(); break;
    case 'consult': {
      const idx = +b.dataset.idx;
      if (ctxOf(idx).sent) { $('#consult-' + idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
      openConsult(idx); break;
    }
    case 'cf-chip': cfChip(b); break;
    case 'consult-send': sendConsult(); break;
    case 'reset': confirmReset(); break;
    case 'reset-go': closeModal(); resetState(); renderStart(); break;
    case 'close-modal': closeModal(); break;
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'n1') { e.preventDefault(); $('#n2').focus(); }
  else if (e.key === 'Enter' && e.target.id === 'n2') { e.preventDefault(); e.target.blur(); }
});

/* 画面が暗くならないように（対応ブラウザのみ） */
let wakeLock = null;
async function keepAwake() {
  try { if (!wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* 非対応なら何もしない */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.people[0].answers.some(a => a != null)) keepAwake();
});

/* オフラインでも開けるように */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- 起動 ---------- */
const sharedData = parseShared();
if (sharedData) renderShared(sharedData); else renderStart();
flushQueue();
