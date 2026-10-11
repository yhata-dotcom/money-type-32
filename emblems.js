/* MONEY TYPE 32 — エンブレム（金の線画）
 * 外周リング＋8つの基本モチーフ＋サブタイプの2つの小さな記号で、32通りの紋章をつくる
 */

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const starPath = (cx, cy, R, r, n = 5) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? r : R;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    d += (i ? 'L' : 'M') + (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
};
const P = (d, extra = '') => `<path class="d" pathLength="1" d="${d}" ${extra}/>`;
const THIN = 'stroke-width="0.8"';

const MOTIFS = {
  // 堅実な資産建築家：神殿の柱
  architect: [
    P('M64 74L100 54L136 74Z'), P(circ(100, 67, 3), THIN),
    P('M60 78H140'), P('M62 83H138', THIN),
    ...[72, 90, 110, 128].map(x => P(`M${x - 3} 88V121M${x + 3} 88V121`)),
    ...[72, 90, 110, 128].map(x => P(`M${x - 5} 88H${x + 5}`, THIN)),
    P('M60 125H140'), P('M56 130H144'),
  ].join(''),
  // 未来の開拓者：羅針盤
  pioneer: [
    P(circ(100, 92, 26), THIN),
    P('M100 50L105 87L142 92L105 97L100 134L95 97L58 92L95 87Z'),
    P('M100 50V134M58 92H142', 'stroke-width="0.6"'),
    P('M118.4 73.6L124 68M81.6 73.6L76 68M118.4 110.4L124 116M81.6 110.4L76 116', THIN),
  ].join(''),
  // のんびり蓄財家：芽吹き
  gardener: [
    P('M100 130C100 116 100 102 100 90'),
    P('M100 104C88 104 76 97 72 84C86 83 97 91 100 104Z'),
    P('M100 92C104 76 118 66 134 66C132 82 118 92 100 92Z'),
    P('M100 92C108 86 116 78 124 72', 'stroke-width="0.6"'),
    P('M62 130Q100 121 138 130'), P('M72 137Q100 131 128 137', THIN),
    P(circ(70, 62, 6), THIN),
  ].join(''),
  // チャンスを探す旅人：帆船
  voyager: [
    P('M100 50V118'), P('M100 50L112 54L100 58', THIN),
    P('M104 58L136 112H104Z'), P('M96 66L70 112H96Z'),
    P('M62 118H138L128 130H72Z'),
    P('M58 139Q69 134 80 139T102 139T124 139T146 139', THIN),
  ].join(''),
  // 暮らしの設計士：家と窓
  designer: [
    P('M60 92L100 58L140 92'), P('M122 77V64H130V84', THIN),
    P('M68 86V130H132V86'),
    P('M88 96H112V118H88Z'), P('M100 96V118M88 107H112', THIN),
    P('M56 130H144'),
  ].join(''),
  // 夢を叶える戦略家：山頂と星
  strategist: [
    P('M54 130L88 76L104 100L118 82L146 130Z'),
    P('M80 89L88 76L96 89', THIN),
    P('M88 76V62L99 66L88 70', THIN),
    `<path class="f" d="M100 130L92 118L102 108L94 96" stroke-width="0.9" stroke-dasharray="2 4"/>`,
    P(starPath(126, 58, 9, 3.8)),
  ].join(''),
  // マイペースな守り手：盾と月
  keeper: [
    P('M100 50L136 62V94C136 114 120 128 100 136C80 128 64 114 64 94V62Z'),
    P('M100 58L128 68V94C128 110 116 121 100 128C84 121 72 110 72 94V68Z', THIN),
    P('M108 79A16 16 0 1 0 108 105A13 13 0 0 1 108 79Z'),
    P(starPath(114, 88, 3.5, 1.5), THIN),
  ].join(''),
  // 自由な冒険家：気球
  adventurer: [
    P('M100 48C122 48 134 64 134 82C134 98 116 108 108 116H92C84 108 66 98 66 82C66 64 78 48 100 48Z'),
    P('M100 48C90 66 90 98 96 116M100 48C110 66 110 98 104 116', THIN),
    P('M68 90C88 96 112 96 132 90', 'stroke-width="0.6"'),
    P('M93 116L95 124M107 116L105 124', THIN),
    P('M94 124H106V132H94Z'),
    P('M54 70q4 -4 8 0q4 -4 8 0', THIN), P('M136 60q3 -3 6 0q3 -3 6 0', THIN),
  ].join(''),
};

// サブタイプの記号：L=方眼（分析） I=きらめき（直感） R=虫めがね（自走） C=ふたつの円（対話）
const GLYPHS = {
  L: (x, y) => P(`M${x - 5} ${y - 5}h10v10h-10ZM${x} ${y - 5}v10M${x - 5} ${y}h10`),
  I: (x, y) => P(`M${x} ${y - 6.5}Q${x} ${y} ${x + 6.5} ${y}Q${x} ${y} ${x} ${y + 6.5}Q${x} ${y} ${x - 6.5} ${y}Q${x} ${y} ${x} ${y - 6.5}Z`),
  R: (x, y) => P(`${circ(x - 1.5, y - 1.5, 4.2)}M${x + 1.6} ${y + 1.6}L${x + 6} ${y + 6}`),
  C: (x, y) => P(`${circ(x - 2.5, y + 0.5, 4)}${circ(x + 3, y - 1, 3.4)}`),
};

let emblemSeq = 0;
function emblemSVG(baseIdx, subIdx, { animate = false, ring = true } = {}) {
  const base = BASES[baseIdx], sub = SUBS[subIdx];
  const no = String(baseIdx * 4 + subIdx + 1).padStart(2, '0');
  const id = 'em' + (++emblemSeq);
  let body = MOTIFS[base.motif] + GLYPHS[sub.key[0]](86, 153) + GLYPHS[sub.key[1]](114, 153);
  if (animate) {
    let i = 0;
    body = body.replace(/class="d"/g, () => `class="d" style="animation-delay:${(0.5 + (i++) * 0.09).toFixed(2)}s"`);
  }
  const rings = [
    P(circ(100, 100, 94), 'stroke-width="1.1"'),
    P(circ(100, 100, 90), 'stroke-width="0.5"'),
    P(circ(100, 100, 72), 'stroke-width="0.8"'),
  ].join('').replace(/class="d"/g, 'class="d ring"');
  const ringText = ring ? `
    <defs>
      <path id="${id}t" d="M20 100A80 80 0 0 1 180 100"/>
      <path id="${id}b" d="M14 100A86 86 0 0 0 186 100"/>
    </defs>
    <g class="ringtext" fill="currentColor" stroke="none">
      <text font-size="8.6" letter-spacing="3.2"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">MONEY TYPE 32</textPath></text>
      <text font-size="7.6" letter-spacing="2.4"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">NO.${no} · ${base.en.toUpperCase()}</textPath></text>
      <circle cx="19" cy="100" r="1.5"/><circle cx="181" cy="100" r="1.5"/>
    </g>` : '';
  return `<svg class="emblem${animate ? ' draw' : ''}" viewBox="0 0 200 200" role="img" aria-label="${base.name}・${sub.name}のエンブレム">
    ${ringText}
    <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      ${rings}${body}
      <circle cx="100" cy="153" r="1" fill="currentColor" stroke="none"/>
    </g>
  </svg>`;
}
