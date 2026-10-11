/* MONEY TYPE 32 — 画面と動き
 * 回答・名前・FPメモはメモリ上にだけ持ち、どこにも保存・送信しない（「次の方へ」で消去）
 * QRで渡すURLは、結果を # 以降に入れる（# 以降はサーバーに送られない）
 */
'use strict';

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const N_Q = QUESTIONS.length;
const MEMO_MAX = 100, STEP_MAX = 30, NAME_MAX = 12;

/* ---------- 状態 ---------- */
const newPerson = (name = '') => ({ name, answers: new Array(N_Q).fill(null), memo: '', step: '' });
let S;
let timers = [];
function resetState() {
  timers.forEach(clearTimeout); timers = [];
  S = { mode: 'single', people: [newPerson()], p: 0, q: 0, concerns: new Set(), tab: 0, lock: false };
}
resetState();

/* ---------- 判定 ---------- */
function scoresOf(answers) {
  const s = [0, 0, 0, 0, 0];
  answers.forEach((side, i) => { if (side === 'a') s[QUESTIONS[i].axis]++; });
  return s;
}
function typeOf(scores) {
  const sides = scores.map(c => (c >= 2 ? 'a' : 'b'));
  const codes = sides.map((sd, i) => AXES[i][sd].code);
  const baseIdx = BASES.findIndex(b => b.key === codes[0] + codes[1] + codes[2]);
  const subIdx = SUBS.findIndex(s => s.key === codes[3] + codes[4]);
  return { scores, sides, codes, baseIdx, subIdx, base: BASES[baseIdx], sub: SUBS[subIdx],
           no: pad(baseIdx * 4 + subIdx + 1), catchCopy: CATCHES[baseIdx][subIdx] };
}
const typeOfPerson = person => typeOf(scoresOf(person.answers));

/* ---------- 共有URL（QR） ---------- */
const b64e = s => {
  let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64d = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
};
function shareURL(person) {
  const base = encodeURI(decodeURI(location.origin + location.pathname));
  let h = 'r=' + scoresOf(person.answers).join('');
  if (person.name) h += '&n=' + b64e(person.name);
  if (person.memo) h += '&m=' + b64e(person.memo);
  if (person.step) h += '&s=' + b64e(person.step);
  return base + '#' + h;
}
function parseShared() {
  const h = location.hash.slice(1);
  if (!h.includes('r=')) return null;
  const q = new URLSearchParams(h);
  const r = q.get('r') || '';
  if (!/^[0-3]{5}$/.test(r)) return null;
  const get = k => { try { return q.get(k) ? b64d(q.get(k)) : ''; } catch (e) { return ''; } };
  return { scores: r.split('').map(Number), name: get('n').slice(0, NAME_MAX), memo: get('m').slice(0, MEMO_MAX), step: get('s').slice(0, STEP_MAX) };
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
function show(html, cls) {
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  window.scrollTo(0, 0);
}
const brandFooter = (cls = '') => `
  <footer class="brand ${cls}">
    <img src="assets/emblem.png" alt="" width="40" height="40">
    <div><b>波多FP事務所</b><span>お金のこと、もっと身近に</span></div>
  </footer>`;

/* ---------- スタート ---------- */
function renderStart() {
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
      <p class="start-lead">15の質問に答えるだけで、32タイプの中から<br>あなたの「お金の性格」がわかります。<br>強みや、将来つまずきやすいポイントも。</p>
      <div class="start-actions">
        <button class="btn btn-gold" data-act="start-single">ひとりで診断する</button>
        <button class="btn btn-line" data-act="start-duo">ふたりで診断する<small>パートナー・ご家族・ご友人と</small></button>
      </div>
      <p class="start-meta">所要時間 約3分<span>｜</span>回答内容は保存されません</p>
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

/* ---------- 質問 ---------- */
function quizCard() {
  const P = S.people[S.p], q = QUESTIONS[S.q];
  return `
    <div class="qcard">
      <p class="qnum">${pad(S.q + 1)}</p>
      <h2 class="qtext">${esc(q.text).replace(/\n/g, '<br>')}</h2>
      <div class="opts">
        ${q.options.map((o, i) => `
          <button class="opt${P.answers[S.q] === o.side ? ' sel' : ''}" data-act="pick" data-side="${o.side}">
            <span class="ab">${'AB'[i]}</span><span class="ot">${esc(o.text)}</span>
          </button>`).join('')}
      </div>
      <p class="qhint">深く考えすぎず、近いと感じるほうを選んでください</p>
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
function pick(side, btn) {
  if (S.lock) return;
  S.lock = true;
  S.people[S.p].answers[S.q] = side;
  btn.parentElement.querySelectorAll('.opt').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel', 'picked');
  timers.push(setTimeout(nextQuestion, 380));
}
function nextQuestion() {
  if (S.q < N_Q - 1) { S.q++; return renderQuiz(); }
  if (S.mode === 'duo' && S.p === 0) return renderHandoff();
  renderConcerns();
}
function prevQuestion() {
  if (S.q > 0) { S.q--; return renderQuiz(); }
  if (S.p === 1) return renderHandoff();
  renderStart();
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
        <button class="btn-text on-dark" data-act="handoff-back">‹ 前の質問にもどる</button>
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
  const msgs = ['5つの軸を読み解いています', S.mode === 'duo' ? 'おふたりのタイプが見つかりました' : 'あなたのタイプが見つかりました'];
  timers.push(setTimeout(() => { const el = $('#rt'); if (el) el.textContent = msgs[0]; }, 1000));
  timers.push(setTimeout(() => { const el = $('#rt'); if (el) el.textContent = msgs[1]; }, 2000));
  timers.push(setTimeout(() => { S.tab = 0; renderResult(true); }, 2900));
}

/* ---------- 結果（本文） ---------- */
function axisRows(scores) {
  const pos = [88, 62, 38, 12]; // aの票数 0..3 → 位置（%）
  return AXES.map((ax, i) => {
    const c = scores[i], win = c >= 2 ? 'a' : 'b';
    return `
      <div class="axis">
        <p class="axis-label"><span>${ax.en}</span>${ax.label}</p>
        <div class="axis-line">
          <span class="side${win === 'a' ? ' win' : ''}">${ax.a.name}</span>
          <span class="track"><i style="left:${pos[c]}%"></i></span>
          <span class="side r${win === 'b' ? ' win' : ''}">${ax.b.name}</span>
        </div>
      </div>`;
  }).join('');
}
const phrase = t => esc(t).replace(/([、。])/g, '$1<wbr>');
const li = arr => arr.map(t => `<li>${esc(t)}</li>`).join('');

function resultBody(t, { name, memo, step, concerns, forLabel, animate, booth }) {
  const { base, sub } = t;
  const memoBlock = (memo || step) ? `
    <section class="r-memo">
      <p class="label">FPからのひとこと</p>
      ${memo ? `<p class="memo-text">${esc(memo)}</p>` : ''}
      ${step ? `<p class="memo-step"><span>今日の一歩</span>${esc(step)}</p>` : ''}
      <p class="memo-sign">波多FP事務所</p>
    </section>` : '';
  const concernChips = concerns && concerns.length
    ? `<p class="talk-sub">いま気になっていること</p><div class="chips static">${concerns.map(c => `<span class="chip on">${esc(c)}</span>`).join('')}</div>` : '';
  return `
    <article class="result">
      <header class="r-hero">
        <div class="r-emblem">${emblemSVG(t.baseIdx, t.subIdx, { animate })}</div>
        <div class="r-title">
          <p class="r-for">${esc(forLabel)}のお金の性格は</p>
          <p class="r-no">TYPE ${t.no} <span>/ 32</span></p>
          <h1 class="r-name">${esc(base.name)}</h1>
          <p class="r-subname">${esc(sub.name)}</p>
          <p class="r-en">${esc(base.en)} — ${esc(sub.en)}</p>
          <p class="r-catch">${phrase(t.catchCopy)}</p>
        </div>
      </header>

      <section class="r-card r-axes">
        <h2 class="sec-h"><span>FIVE AXES</span>5つの軸で見るあなた</h2>
        ${axisRows(t.scores)}
      </section>

      <section class="r-sec">
        <h2 class="sec-h"><span>PERSONALITY</span>お金の性格</h2>
        <p class="lead-tagline">${phrase(base.tagline)}</p>
        <p>${esc(base.desc)}</p>
        <p>${esc(sub.desc)}</p>
      </section>

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

      <section class="r-point">
        <p class="label">FPからのワンポイント</p>
        <p>${esc(base.onePoint)}</p>
      </section>

      ${memoBlock}

      <section class="r-sec talk">
        <h2 class="sec-h"><span>LET'S TALK</span>${booth ? 'FPと話してみたいテーマ' : 'FPに相談してみたいテーマ'}</h2>
        ${concernChips}
        <ul class="ls">${li(base.talk)}</ul>
      </section>

      <p class="disclaimer">※${esc(DISCLAIMER)}</p>
    </article>`;
}

/* ---------- ふたりの相性 ---------- */
function pairBody(animate) {
  const [t1, t2] = S.people.map(typeOfPerson);
  const same = t1.sides.filter((s, i) => s === t2.sides[i]).length;
  const sum = PAIR_SUMMARY.find(p => same >= p.min);
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
        <p class="p-sides"><span><small>${esc(dispName(0))}</small>${ax[s1].name}</span><span><small>${esc(dispName(1))}</small>${ax[s2].name}</span></p>
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
  const duo = S.mode === 'duo';
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
        ${S.tab === 2 ? '' : '<button class="tb-btn" data-act="memo">FPメモ</button>'}
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
  const P = S.people[S.tab];
  return resultBody(typeOfPerson(P), {
    name: P.name, memo: P.memo, step: P.step, animate, booth: true,
    concerns: [...S.concerns].sort((a, b) => a - b).map(i => CONCERNS[i]),
    forLabel: dispName(S.tab),
  });
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
        ${qrSVG(shareURL(P))}
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
    <h3 class="m-title">FPメモ<small>${esc(dispName(S.tab))}の結果に表示され、QRにも入ります</small></h3>
    <label class="f-label" for="memo">FPからのひとこと<span class="cnt"><b id="mc">0</b> / ${MEMO_MAX}</span></label>
    <textarea id="memo" maxlength="${MEMO_MAX}" rows="3" placeholder="例：まずは生活費の3〜6か月分を確保しましょう。">${esc(P.memo)}</textarea>
    <div class="phr">${MEMO_PHRASES.map(t => `<button data-act="phrase" data-target="memo" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="f-label" for="step">今日の一歩<span class="cnt"><b id="sc">0</b> / ${STEP_MAX}</span></label>
    <input id="step" maxlength="${STEP_MAX}" value="${esc(P.step)}" placeholder="例：今月の収支を書き出す" autocomplete="off">
    <div class="phr">${STEP_PHRASES.map(t => `<button data-act="phrase" data-target="step" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="m-row">
      <button class="btn-text" data-act="memo-clear">すべて消す</button>
      <button class="btn btn-navy" data-act="memo-save">結果に反映する</button>
    </div>`, 'memo-modal');
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
  $('#rbody').innerHTML = resultContent(false);
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

/* ---------- 共有ページ（来場者のスマホ） ---------- */
function renderShared(d) {
  const t = typeOf(d.scores);
  document.title = `${t.base.name}｜MONEY TYPE 32`;
  show(`
    <header class="share-head">
      <p class="tb-mark">MONEY TYPE <b>32</b></p>
      <p class="share-sub">お金の性格診断 ・ 診断結果</p>
    </header>
    ${resultBody(t, { name: d.name, memo: d.memo, step: d.step, animate: true, booth: false, forLabel: d.name ? d.name + 'さん' : 'あなた' })}
    <div class="share-again"><a class="btn btn-line dark-text" href="./">もう一度診断する</a></div>
    ${brandFooter()}`, 'light result-screen shared');
}

/* ---------- 操作 ---------- */
app.addEventListener('click', handle);
document.body.addEventListener('click', e => { if (e.target.closest('.modal-back')) handle(e); });
function handle(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  keepAwake();
  const act = b.dataset.act;
  switch (act) {
    case 'home': resetState(); renderStart(); break;
    case 'start-single': resetState(); renderQuiz(); break;
    case 'start-duo': resetState(); renderNames(); break;
    case 'duo-begin': {
      const n1 = $('#n1').value.trim().slice(0, NAME_MAX), n2 = $('#n2').value.trim().slice(0, NAME_MAX);
      resetState(); S.mode = 'duo'; S.people = [newPerson(n1), newPerson(n2)];
      document.activeElement?.blur(); renderQuiz(); break;
    }
    case 'pick': pick(b.dataset.side, b); break;
    case 'back': prevQuestion(); break;
    case 'handoff-go': S.p = 1; S.q = 0; renderQuiz(); break;
    case 'handoff-back': S.p = 0; S.q = N_Q - 1; renderQuiz(); break;
    case 'concern': {
      const i = +b.dataset.i;
      S.concerns.has(i) ? S.concerns.delete(i) : S.concerns.add(i);
      b.classList.toggle('on'); break;
    }
    case 'concerns-back': S.p = S.people.length - 1; S.q = N_Q - 1; renderQuiz(); break;
    case 'to-result': renderReveal(); break;
    case 'tab': S.tab = +b.dataset.tab; renderResult(true); break;
    case 'qr': openQR(); break;
    case 'memo': openMemo(); break;
    case 'phrase': insertPhrase(b.dataset.target, b.dataset.text); break;
    case 'memo-clear': $('#memo').value = ''; $('#step').value = ''; $('#memo').dispatchEvent(new Event('input', { bubbles: true })); break;
    case 'memo-save': saveMemo(); break;
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.people[0].answers.some(a => a)) keepAwake(); });

/* オフラインでも開けるように */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- 起動 ---------- */
const shared = parseShared();
if (shared) renderShared(shared); else renderStart();
