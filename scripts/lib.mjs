// Teia Universal — utilitários sem dependências externas (Markdown, frontmatter, arte procedural)

export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const semAcento = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- Frontmatter (JSON entre linhas ---) ----------
export function lerFrontmatter(txt, arquivo) {
  txt = txt.replace(/\r\n/g, '\n');
  if (!txt.startsWith('---\n')) return { meta: {}, corpo: txt, erro: `${arquivo}: sem frontmatter (deve começar com ---)` };
  const fim = txt.indexOf('\n---\n', 4);
  if (fim < 0) return { meta: {}, corpo: txt, erro: `${arquivo}: frontmatter sem fechamento ---` };
  const bruto = txt.slice(4, fim);
  try {
    return { meta: JSON.parse(bruto), corpo: txt.slice(fim + 5) };
  } catch (e) {
    return { meta: {}, corpo: txt.slice(fim + 5), erro: `${arquivo}: JSON inválido no frontmatter — ${e.message}` };
  }
}

// ---------- Markdown ----------
// Suporta: títulos, parágrafos, listas (- * 1.), citações, tabelas, ---, código,
// blocos HTML/SVG crus, caixas :::tipo Título ... :::, links wiki [[id]] / [[id|texto]].
export function markdown(src, ctx) {
  const toc = [];
  const usadosIds = new Set();
  const linhas = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const inline = (t) => {
    const codigos = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => { codigos.push(`<code>${esc(c)}</code>`); return `\u0000${codigos.length - 1}\u0000`; });
    t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, txt) => ctx.wiki(id.trim(), txt && txt.trim()));
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img src="${ctx.url(url)}" alt="${esc(alt)}" loading="lazy">`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
      const ext = /^https?:/.test(url);
      return `<a href="${ext ? url : ctx.url(url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => codigos[n]);
    return t;
  };

  const blocoHtml = /^\s*<(svg|div|figure|table|details|section|aside|iframe|p|ul|ol|blockquote|nav|span|a)\b/i;

  while (i < linhas.length) {
    let l = linhas[i];
    if (!l.trim()) { i++; continue; }

    // código cercado
    if (l.startsWith('```')) {
      const buf = []; i++;
      while (i < linhas.length && !linhas[i].startsWith('```')) buf.push(linhas[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    // caixas :::tipo Título
    const cx = l.match(/^:::(\w+)\s*(.*)$/);
    if (cx) {
      const buf = []; i++; let prof = 1;
      while (i < linhas.length) {
        if (/^:::\w+/.test(linhas[i])) prof++;
        else if (linhas[i].trim() === ':::') { prof--; if (!prof) break; }
        buf.push(linhas[i++]);
      }
      i++;
      const interno = markdown(buf.join('\n'), ctx).html;
      const rotulos = { tradicao: 'Segundo a tradição', destaque: 'Destaque', reflexao: 'Para refletir', atencao: 'Atenção', ciencia: 'O que diz a ciência', pratica: 'Prática' };
      const titulo = cx[2] || rotulos[cx[1]] || '';
      out.push(`<aside class="caixa caixa-${cx[1]}">${titulo ? `<div class="caixa-titulo">${inline(titulo)}</div>` : ''}${interno}</aside>`);
      continue;
    }
    // HTML cru (até linha em branco)
    if (blocoHtml.test(l)) {
      const buf = [];
      while (i < linhas.length && linhas[i].trim()) buf.push(linhas[i++]);
      out.push(buf.join('\n')); continue;
    }
    // títulos
    const h = l.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const n = h[1].length; const texto = h[2].trim();
      let id = slugify(texto) || 'secao'; let k = 2;
      while (usadosIds.has(id)) id = slugify(texto) + '-' + k++;
      usadosIds.add(id);
      if (n === 2 || n === 3) toc.push({ n, id, texto: texto.replace(/[*`]/g, '') });
      out.push(`<h${n} id="${id}">${inline(texto)}<a class="ancora" href="#${id}" aria-label="Link para esta seção">#</a></h${n}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    // citação
    if (l.startsWith('>')) {
      const buf = [];
      while (i < linhas.length && linhas[i].startsWith('>')) buf.push(linhas[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(buf.join('\n'), ctx).html}</blockquote>`); continue;
    }
    // tabela
    if (l.trim().startsWith('|') && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1])) {
      const cel = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cab = cel(l); i += 2; const rows = [];
      while (i < linhas.length && linhas[i].trim().startsWith('|')) rows.push(cel(linhas[i++]));
      out.push(`<div class="tabela"><table><thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // listas
    const li = l.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ord = /\d/.test(li[1]); const itens = [];
      while (i < linhas.length) {
        const m = linhas[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (m) { itens.push(m[2]); i++; }
        else if (linhas[i].trim() && /^\s{2,}/.test(linhas[i]) && itens.length) { itens[itens.length - 1] += ' ' + linhas[i].trim(); i++; }
        else break;
      }
      out.push(`<${ord ? 'ol' : 'ul'}>${itens.map((x) => `<li>${inline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`);
      continue;
    }
    // parágrafo
    const buf = [];
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,4}\s|>|```|:::|\s*([-*]|\d+\.)\s|\|)/.test(linhas[i]) && !blocoHtml.test(linhas[i])) buf.push(linhas[i++].trim());
    if (!buf.length) { buf.push(linhas[i++].trim()); }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), toc };
}

// Envolve a primeira ocorrência de cada termo do glossário (fora de links, títulos, svg, código)
export function marcarGlossario(html, termos) {
  if (!termos.length) return html;
  const pendentes = new Map(termos.map((t) => [semAcento(t.termo), t]));
  const partes = html.split(/(<[^>]+>)/);
  const pilha = [];
  const bloqueia = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'svg', 'code', 'pre', 'dfn', 'button', 'summary', 'th']);
  for (let k = 0; k < partes.length; k++) {
    const p = partes[k];
    if (p.startsWith('<')) {
      const m = p.match(/^<\/?([a-zA-Z0-9]+)/); if (!m) continue;
      const tag = m[1].toLowerCase();
      if (/\/>$/.test(p)) continue;
      if (p.startsWith('</')) { const idx = pilha.lastIndexOf(tag); if (idx >= 0) pilha.splice(idx); }
      else if (bloqueia.has(tag)) pilha.push(tag);
      continue;
    }
    if (pilha.length || !p.trim()) continue;
    let texto = p;
    for (const [chave, t] of pendentes) {
      const re = new RegExp(`(^|[^\\p{L}])(${t.termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'iu');
      const m = texto.match(re);
      if (m) {
        texto = texto.replace(re, `$1<dfn class="g" tabindex="0" data-def="${esc(t.definicao)}">$2</dfn>`);
        pendentes.delete(chave);
      }
    }
    partes[k] = texto;
  }
  return partes.join('');
}

// ---------- Arte procedural (geometria sagrada única por página) ----------
function prng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export function arte(seed, hue, { tam = 400, simbolo = '' } = {}) {
  const r = prng(seed); const c = tam / 2; const g = `g${slugify(seed).slice(0, 24)}${Math.floor(r() * 1e6)}`;
  const cor = (l, a = 1, dh = 0) => `hsla(${(hue + dh + 360) % 360},80%,${l}%,${a})`;
  const el = [];
  el.push(`<defs><radialGradient id="${g}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${cor(62, .55)}"/><stop offset="45%" stop-color="${cor(30, .25, 30)}"/><stop offset="100%" stop-color="${cor(8, 0)}"/></radialGradient></defs>`);
  el.push(`<rect width="${tam}" height="${tam}" fill="url(#${g})"/>`);
  for (let k = 0; k < 70; k++) el.push(`<circle cx="${(r() * tam).toFixed(1)}" cy="${(r() * tam).toFixed(1)}" r="${(r() * 1.3 + .2).toFixed(2)}" fill="#fff" opacity="${(r() * .7 + .1).toFixed(2)}"/>`);
  const petalas = [6, 8, 12, 5, 7, 9][Math.floor(r() * 6)];
  const raio = tam * (0.16 + r() * 0.06);
  el.push(`<g fill="none" stroke-width="1.1">`);
  for (let k = 0; k < petalas; k++) {
    const a = (k / petalas) * Math.PI * 2;
    el.push(`<circle cx="${(c + Math.cos(a) * raio).toFixed(1)}" cy="${(c + Math.sin(a) * raio).toFixed(1)}" r="${raio.toFixed(1)}" stroke="${cor(72, .55)}"/>`);
  }
  el.push(`<circle cx="${c}" cy="${c}" r="${raio.toFixed(1)}" stroke="${cor(80, .8)}"/>`);
  const aneis = 2 + Math.floor(r() * 3);
  for (let k = 1; k <= aneis; k++) el.push(`<circle cx="${c}" cy="${c}" r="${(raio * (1.7 + k * 0.42)).toFixed(1)}" stroke="${cor(70, .35 - k * .05, k * 25)}" stroke-dasharray="${k % 2 ? '2 6' : '0'}"/>`);
  const lados = [3, 4, 5, 6][Math.floor(r() * 4)];
  for (let v = 0; v < 2; v++) {
    const pts = []; const rr = raio * 2.05; const rot = v * Math.PI / lados - Math.PI / 2;
    for (let k = 0; k < lados; k++) { const a = rot + (k / lados) * Math.PI * 2; pts.push(`${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`); }
    el.push(`<polygon points="${pts.join(' ')}" stroke="${cor(78, .5, 40)}"/>`);
  }
  // fios da teia: raios conectando pontos de órbita
  const nos = []; for (let k = 0; k < 9; k++) { const a = r() * Math.PI * 2; const d = raio * (2.4 + r() * 1.1); nos.push([c + Math.cos(a) * d, c + Math.sin(a) * d]); }
  nos.forEach(([x, y], k) => { const [x2, y2] = nos[(k + 3) % nos.length]; el.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${cor(75, .18)}"/>`); });
  el.push(`</g>`);
  nos.forEach(([x, y]) => el.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${cor(85, .9)}"/>`));
  el.push(`<circle cx="${c}" cy="${c}" r="${(raio * .32).toFixed(1)}" fill="${cor(88, .9)}" opacity=".9"/>`);
  if (simbolo) el.push(`<text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-size="${(raio * .42).toFixed(0)}" fill="${cor(15, 1)}">${esc(simbolo)}</text>`);
  return `<svg viewBox="0 0 ${tam} ${tam}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${el.join('')}</svg>`;
}

export const dataBR = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${+d} ${meses[+m - 1]} ${a}`;
};
