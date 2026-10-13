// Teia Universal — gerador do site estático
// Uso: node scripts/build.mjs           -> gera _site/
//      node scripts/build.mjs --check   -> gera e falha (exit 1) se houver ERROS no diagnóstico
import fs from 'node:fs';
import path from 'node:path';
import { esc, slugify, semAcento, lerFrontmatter, markdown, marcarGlossario, arte, dataBR } from './lib.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(RAIZ, '_site');
const lerJSON = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));
const cfg = lerJSON('site.config.json');
const { eixos, secoes } = lerJSON('dados/secoes.json');
const fila = lerJSON('dados/fila.json').itens || [];
const trilhas = lerJSON('dados/trilhas.json');
const HOJE = new Date().toISOString().slice(0, 10);
const BASE = (cfg.basePath || '').replace(/\/$/, '');
const U = (p = '/') => (p.startsWith('http') ? p : BASE + (p.startsWith('/') ? p : '/' + p));
const ABS = (p) => cfg.url.replace(/\/$/, '') + U(p);
const eixoDe = Object.fromEntries(eixos.map((e) => [e.id, e]));
const secaoDe = Object.fromEntries(secoes.map((s, i) => [s.id, { ...s, ordem: i + 1, hue: eixoDe[s.eixo]?.cor ?? 260 }]));
const diag = { erros: [], avisos: [], dicas: [] };
const ERRO = (m) => diag.erros.push(m); const AVISO = (m) => diag.avisos.push(m); const DICA = (m) => diag.dicas.push(m);
const ISSUE = (tpl, extra = {}) => `https://github.com/${cfg.repo}/issues/new?template=${tpl}` + Object.entries(extra).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');

// ---------------- 1. Ler conteúdo ----------------
const paginas = new Map();
const dirConteudo = path.join(RAIZ, 'conteudo');
for (const sid of fs.existsSync(dirConteudo) ? fs.readdirSync(dirConteudo) : []) {
  const dir = path.join(dirConteudo, sid);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (!secaoDe[sid]) { ERRO(`Pasta conteudo/${sid} não corresponde a nenhuma seção em dados/secoes.json`); continue; }
  for (const arq of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const rel = `conteudo/${sid}/${arq}`;
    const { meta, corpo, erro } = lerFrontmatter(fs.readFileSync(path.join(dir, arq), 'utf8'), rel);
    if (erro) { ERRO(erro); continue; }
    const tipo = arq === 'index.md' ? 'secao' : 'subtema';
    const id = tipo === 'secao' ? sid : `${sid}/${arq.replace(/\.md$/, '')}`;
    if (!meta.titulo) ERRO(`${rel}: falta "titulo"`);
    if (!meta.resumo) AVISO(`${rel}: falta "resumo" (importante para Google)`);
    paginas.set(id, { id, secao: sid, tipo, meta, corpo, arquivo: rel, url: `/${id}/` });
  }
}
// seções sem index.md viram páginas "em preparação"
for (const s of secoes) {
  if (!paginas.has(s.id)) paginas.set(s.id, { id: s.id, secao: s.id, tipo: 'secao', preparacao: true, meta: { titulo: s.titulo, resumo: s.resumo, relacionados: s.relacionados }, corpo: '', arquivo: null, url: `/${s.id}/` });
}
const publicadas = [...paginas.values()].filter((p) => !p.preparacao);
const planejados = new Map(fila.filter((f) => f.status !== 'publicado').map((f) => [f.id, f]));

// ---------------- 2. Glossário global ----------------
const glossario = new Map();
for (const p of publicadas) for (const g of p.meta.glossario || []) {
  if (!g.termo || !g.definicao) { AVISO(`${p.arquivo}: item de glossário incompleto`); continue; }
  const k = semAcento(g.termo);
  if (!glossario.has(k)) glossario.set(k, { ...g, origem: p.id });
}

// ---------------- 3. Renderizar markdown e mapear links ----------------
const saidas = new Map(); // id -> Set(ids citados)
for (const p of publicadas) {
  const citados = new Set();
  const ctx = {
    url: (u) => (u.startsWith('/') ? U(u) : u),
    wiki: (id, txt) => {
      id = id.replace(/^\/|\/$/g, '');
      const alvo = paginas.get(id);
      if (alvo && !alvo.preparacao) { citados.add(id); return `<a class="wl" href="${U(alvo.url)}">${esc(txt || alvo.meta.titulo)}</a>`; }
      if (alvo?.preparacao || planejados.has(id)) { citados.add(id); return `<span class="wl-futuro" title="Página em preparação">${esc(txt || alvo?.meta.titulo || planejados.get(id).titulo)}</span>`; }
      AVISO(`${p.arquivo}: link [[${id}]] aponta para página inexistente — crie a página ou adicione à fila`);
      return `<span class="wl-futuro">${esc(txt || id)}</span>`;
    },
  };
  const { html, toc } = markdown(p.corpo, ctx);
  p.html = marcarGlossario(html, [...glossario.values()]);
  p.toc = toc;
  const texto = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  p.palavras = texto.split(/\s+/).filter(Boolean).length;
  p.textoBusca = texto.replace(/\s+/g, ' ').slice(0, 900);
  saidas.set(p.id, citados);
}

// ---------------- 4. Conexões (o cruzamento central) ----------------
const entradas = new Map();
for (const [de, set] of saidas) for (const para of set) { if (!entradas.has(para)) entradas.set(para, new Set()); entradas.get(para).add(de); }
function conexoes(p) {
  const mapa = new Map();
  const add = (id, tipo) => { if (id === p.id || !paginas.has(id)) return; if (!mapa.has(id)) mapa.set(id, new Set()); mapa.get(id).add(tipo); };
  if (p.tipo === 'subtema') add(p.secao, 'pai');
  if (p.tipo === 'secao') for (const q of publicadas) if (q.secao === p.id && q.tipo === 'subtema') add(q.id, 'filho');
  if (p.tipo === 'subtema') for (const q of publicadas) if (q.secao === p.secao && q.tipo === 'subtema') add(q.id, 'irmao');
  for (const id of p.meta.relacionados || []) { if (!paginas.has(id)) AVISO(`${p.arquivo || p.id}: relacionado "${id}" não existe`); add(id, 'relacionado'); }
  if (p.tipo === 'secao') for (const id of secaoDe[p.id].relacionados || []) add(id, 'relacionado');
  for (const id of saidas.get(p.id) || []) add(id, 'cita');
  for (const id of entradas.get(p.id) || []) add(id, 'citado');
  // relações recíprocas declaradas por outras páginas
  for (const q of paginas.values()) if ((q.meta.relacionados || []).includes(p.id)) add(q.id, 'relacionado');
  return [...mapa.entries()].map(([id, tipos]) => ({ id, tipos: [...tipos], p: paginas.get(id) }));
}

// ---------------- 5. Componentes de layout ----------------
const fonteHead = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">`;
const adsHead = cfg.adsenseClient ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.adsenseClient)}" crossorigin="anonymous"></script>` : '';
const gaHead = cfg.googleAnalyticsId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(cfg.googleAnalyticsId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(cfg.googleAnalyticsId)}');</script>` : '';
const anuncio = () => (cfg.adsenseClient && cfg.adsenseSlot ? `<div class="anuncio" aria-label="Publicidade"><span>Publicidade</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.adsenseClient)}" data-ad-slot="${esc(cfg.adsenseSlot)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>` : '');

const logo = `<svg viewBox="0 0 48 48" aria-hidden="true" class="logo-svg"><g fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="24" cy="24" r="21" opacity=".35"/><circle cx="24" cy="24" r="13" opacity=".6"/><path d="M24 3v42M3 24h42M9.2 9.2l29.6 29.6M38.8 9.2 9.2 38.8" opacity=".45"/><path d="M24 11 35.3 17.5v13L24 37 12.7 30.5v-13Z"/></g><circle cx="24" cy="24" r="3.4" fill="currentColor"/></svg>`;

const menuSecoes = secoes.map((s, i) => {
  const subs = publicadas.filter((p) => p.secao === s.id && p.tipo === 'subtema').length;
  const prep = paginas.get(s.id).preparacao;
  return `<li><a href="${U('/' + s.id + '/')}" style="--h:${secaoDe[s.id].hue}"><span class="mm-n">${String(i + 1).padStart(2, '0')}</span><span class="mm-s">${s.simbolo}</span><span class="mm-t">${esc(s.titulo)}</span>${subs ? `<span class="mm-c">${subs}</span>` : ''}${prep ? '<span class="mm-p" title="Em preparação">•</span>' : ''}</a></li>`;
}).join('');

function layout({ titulo, descricao, caminho, corpo, hue = 260, noindex = false, jsonld = null, tipoOG = 'website', imagemOG = '' }) {
  const tituloCompleto = caminho === '/' ? `${cfg.nome} — ${cfg.slogan}` : `${titulo} · ${cfg.nome}`;
  return `<!doctype html>
<html lang="${cfg.idioma}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tituloCompleto)}</title>
<meta name="description" content="${esc(descricao)}">
<link rel="canonical" href="${ABS(caminho)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
${cfg.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(cfg.googleSiteVerification)}">` : ''}
<meta property="og:type" content="${tipoOG}"><meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(descricao)}"><meta property="og:url" content="${ABS(caminho)}"><meta property="og:site_name" content="${esc(cfg.nome)}"><meta property="og:locale" content="pt_BR">${imagemOG ? `<meta property="og:image" content="${imagemOG}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#07081a">
<link rel="icon" href="${U('/assets/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.nome)}" href="${U('/feed.xml')}">
${fonteHead}
<link rel="stylesheet" href="${U('/assets/estilo.css')}">
${adsHead}${gaHead}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body style="--h:${hue}" data-base="${BASE}">
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<div class="ceu" aria-hidden="true"></div>
<header class="topo">
  <div class="topo-in">
    <a class="marca" href="${U('/')}">${logo}<span>${esc(cfg.nome)}</span></a>
    <nav class="nav" aria-label="Principal">
      <button class="nav-temas" aria-expanded="false" aria-controls="megamenu">Temas <span aria-hidden="true">▾</span></button>
      <a href="${U('/mapa/')}">Mapa</a>
      <a href="${U('/trilhas/')}">Trilhas</a>
      <a href="${U('/glossario/')}">Glossário</a>
    </nav>
    <button class="btn-busca" aria-label="Buscar (Ctrl+K)"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Buscar</span><kbd>Ctrl K</kbd></button>
    <button class="btn-menu" aria-label="Abrir menu" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
  <div class="megamenu" id="megamenu" hidden>
    <div class="mm-in">
      <p class="mm-tit">Os ${secoes.length} portais da Teia, em ordem de estudo</p>
      <ol class="mm-lista">${menuSecoes}</ol>
      <div class="mm-links"><a href="${U('/mapa/')}">Mapa de conexões</a><a href="${U('/trilhas/')}">Trilhas de estudo</a><a href="${U('/glossario/')}">Glossário</a><a href="${U('/busca/')}">Busca</a><a href="${U('/novidades/')}">Novidades</a></div>
    </div>
  </div>
</header>
<main id="conteudo">
${corpo}
</main>
<footer class="rodape">
  <div class="rodape-in">
    <div><a class="marca" href="${U('/')}">${logo}<span>${esc(cfg.nome)}</span></a><p>${esc(cfg.slogan)}.</p><p class="peq">Conteúdo educativo que apresenta o que ensinam diferentes tradições espirituais. Não substitui orientação médica, psicológica ou religiosa.</p></div>
    <div><h3>Explorar</h3><a href="${U('/mapa/')}">Mapa de conexões</a><a href="${U('/trilhas/')}">Trilhas</a><a href="${U('/glossario/')}">Glossário</a><a href="${U('/novidades/')}">Novidades</a><a href="${U('/feed.xml')}">RSS</a></div>
    <div><h3>O projeto</h3><a href="${U('/sobre/')}">Sobre e método</a><a href="${U('/contato/')}">Contato</a><a href="${U('/privacidade/')}">Privacidade e cookies</a><a href="${U('/termos/')}">Termos de uso</a></div>
  </div>
  <p class="rodape-fim">© ${HOJE.slice(0, 4)} ${esc(cfg.nome)} · Atualizado em ${dataBR(HOJE)} · <a href="${U('/painel/')}" rel="nofollow">Painel</a></p>
</footer>
<div class="busca-ov" hidden role="dialog" aria-label="Busca" aria-modal="true">
  <div class="busca-caixa"><input type="search" placeholder="Busque um tema, termo ou tradição…" aria-label="Buscar"><ul class="busca-res"></ul><p class="busca-dica">↑↓ para navegar · Enter para abrir · Esc para fechar</p></div>
</div>
<script src="${U('/assets/app.js')}" defer></script>
</body>
</html>`;
}

const tempoLeitura = (n) => Math.max(1, Math.round(n / 200));
const nivelNome = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };

// Constelação estática de conexões (SVG sem JS)
function constelacao(p, cons) {
  const W = 340, c = W / 2, R = 125; const nos = cons.slice(0, 12);
  const corTipo = (t) => (t.includes('pai') || t.includes('filho') ? 'var(--ouro)' : t.includes('citado') || t.includes('cita') ? 'hsl(190 80% 70%)' : 'hsl(var(--h) 80% 75%)');
  const partes = nos.map((n, k) => {
    const a = (k / nos.length) * Math.PI * 2 - Math.PI / 2; const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
    const nome = n.p.meta.titulo.length > 22 ? n.p.meta.titulo.slice(0, 21) + '…' : n.p.meta.titulo;
    const anc = Math.cos(a) > .3 ? 'start' : Math.cos(a) < -.3 ? 'end' : 'middle';
    const dx = anc === 'start' ? 8 : anc === 'end' ? -8 : 0; const dy = Math.sin(a) > .3 ? 16 : Math.sin(a) < -.3 ? -9 : 4;
    return { svg: `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${corTipo(n.tipos)}" stroke-opacity=".45"/>`, no: `<a href="${U(n.p.url)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${corTipo(n.tipos)}"${n.p.preparacao ? ' fill-opacity=".35"' : ''}/><text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anc}">${esc(nome)}</text></a>` };
  });
  return `<svg class="constelacao" viewBox="-70 0 ${W + 140} ${W}" role="img" aria-label="Constelação de conexões de ${esc(p.meta.titulo)}">${partes.map((x) => x.svg).join('')}<circle cx="${c}" cy="${c}" r="26" fill="hsl(var(--h) 70% 55% / .25)" stroke="hsl(var(--h) 80% 75%)"/><circle cx="${c}" cy="${c}" r="7" fill="var(--ouro)"/>${partes.map((x) => x.no).join('')}</svg>`;
}

function cartao(p, extra = '') {
  const s = secaoDe[p.secao];
  return `<a class="cartao${p.preparacao ? ' cartao-prep' : ''}" href="${U(p.url)}" style="--h:${s.hue}">
  <div class="cartao-arte">${arte(p.id, s.hue, { tam: 200, simbolo: p.tipo === 'secao' ? s.simbolo : '' })}</div>
  <div class="cartao-txt"><span class="rotulo">${p.tipo === 'secao' ? `Portal ${String(s.ordem).padStart(2, '0')}` : esc(s.titulo)}</span><h3>${esc(p.meta.titulo)}</h3><p>${esc(p.meta.resumo || '')}</p>${extra}</div></a>`;
}

// ---------------- 6. Páginas de conteúdo ----------------
const escrever = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ordemGlobal = []; // ordem de leitura: seção, seus subtemas, próxima seção…
for (const s of secoes) {
  ordemGlobal.push(paginas.get(s.id));
  publicadas.filter((p) => p.secao === s.id && p.tipo === 'subtema').sort((a, b) => (a.meta.ordem ?? 99) - (b.meta.ordem ?? 99) || a.meta.titulo.localeCompare(b.meta.titulo)).forEach((p) => ordemGlobal.push(p));
}

for (const p of paginas.values()) {
  const s = secaoDe[p.secao]; const m = p.meta; const cons = conexoes(p);
  const idx = ordemGlobal.indexOf(p); const ant = ordemGlobal[idx - 1]; const prox = ordemGlobal[idx + 1];
  const subtemasPub = publicadas.filter((q) => q.secao === s.id && q.tipo === 'subtema');
  const subtemasPlan = fila.filter((f) => f.status !== 'publicado' && f.id.startsWith(s.id + '/'));
  const trilhaInfo = trilhas.map((t) => ({ t, i: t.passos.indexOf(p.id) })).filter((x) => x.i >= 0);

  if (!p.preparacao) {
    if (p.palavras < 700) AVISO(`${p.arquivo}: texto curto (${p.palavras} palavras) — aprofundar para pelo menos 1.200`);
    if (!(m.quiz || []).length) DICA(`${p.arquivo}: sem quiz`);
    if (!(m.fontes || []).length) AVISO(`${p.arquivo}: sem fontes/referências`);
    if (!(m.glossario || []).length) DICA(`${p.arquivo}: sem termos de glossário`);
    if (cons.length < 3) AVISO(`${p.arquivo}: poucas conexões (${cons.length}) — adicionar [[links]] ou "relacionados"`);
    const dias = (Date.parse(HOJE) - Date.parse(m.atualizado || m.criado || HOJE)) / 864e5;
    if (dias > 180) AVISO(`${p.arquivo}: sem atualização há ${Math.round(dias)} dias`);
    (m.quiz || []).forEach((q, k) => { if (!(q.opcoes || []).length || q.correta == null || q.correta >= q.opcoes.length) ERRO(`${p.arquivo}: quiz #${k + 1} com "correta" inválida`); });
  }

  const jaListado = new Set();
  const listaCons = (tipo, rot) => { const l = cons.filter((c) => c.tipos.includes(tipo) && !jaListado.has(c.id)); l.forEach((c) => jaListado.add(c.id)); return l.length ? `<div class="con-grupo"><h4>${rot}</h4><ul>${l.map((c) => `<li><a href="${U(c.p.url)}"${c.p.preparacao ? ' class="prep"' : ''}>${esc(c.p.meta.titulo)}</a></li>`).join('')}</ul></div>` : ''; };

  const quiz = (m.quiz || []).length ? `<section class="quiz" id="quiz" aria-labelledby="quiz-t"><h2 id="quiz-t">Teste seu entendimento</h2><p class="quiz-placar" aria-live="polite">0 de ${m.quiz.length} respondidas</p>${m.quiz.map((q, k) => `<fieldset class="q" data-correta="${q.correta}"><legend><span>${k + 1}</span>${esc(q.pergunta)}</legend>${q.opcoes.map((o, j) => `<button type="button" data-i="${j}">${esc(o)}</button>`).join('')}<p class="q-exp" hidden>${esc(q.explicacao || '')}</p></fieldset>`).join('')}</section>` : '';
  const gloss = (m.glossario || []).length ? `<section class="gl-pag"><h2>Termos desta página</h2><dl>${m.glossario.map((g) => `<div><dt>${esc(g.termo)}</dt><dd>${esc(g.definicao)}</dd></div>`).join('')}</dl><a href="${U('/glossario/')}">Ver glossário completo →</a></section>` : '';
  const fontes = (m.fontes || []).length ? `<section class="fontes"><h2>Fontes e leituras</h2><ol>${m.fontes.map((f) => `<li>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.titulo)}</a>` : `<cite>${esc(f.titulo)}</cite>`}${f.autor ? ` — ${esc(f.autor)}` : ''}${f.ano ? ` (${esc(String(f.ano))})` : ''}${f.nota ? `. <span class="peq">${esc(f.nota)}</span>` : ''}</li>`).join('')}</ol></section>` : '';
  const toc = (p.toc || []).filter((t) => t.n === 2);
  const tocHtml = toc.length > 2 ? `<nav class="toc" aria-label="Nesta página"><p>Nesta página</p><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.texto)}</a></li>`).join('')}${quiz ? '<li><a href="#quiz">Quiz</a></li>' : ''}<li><a href="#conexoes">Conexões</a></li></ol></nav>` : '';

  // insere anúncio após o 2º h2
  let corpoHtml = p.html || '';
  if (anuncio()) { let n = 0; corpoHtml = corpoHtml.replace(/<h2 /g, (x) => (++n === 3 ? anuncio() + x : x)); }

  const blocoSecao = p.tipo === 'secao' ? `<section class="subtemas"><h2>Subtemas de ${esc(s.titulo)}</h2>${subtemasPub.length ? `<div class="grade grade-sub">${subtemasPub.map((q) => cartao(q)).join('')}</div>` : ''}${subtemasPlan.length ? `<div class="planejados"><h3>Em preparação</h3><ul>${subtemasPlan.map((f) => `<li>${esc(f.titulo)}</li>`).join('')}</ul><p class="peq">Novas páginas são publicadas e aprofundadas continuamente.</p></div>` : ''}${!subtemasPub.length && !subtemasPlan.length ? '<p class="peq">Subtemas em breve.</p>' : ''}</section>` : '';

  const prepHtml = p.preparacao ? `<div class="prep-aviso"><p><strong>Este portal está sendo escrito.</strong> A página aprofundada sobre <em>${esc(s.titulo)}</em> entra na fila editorial e será publicada em breve. Enquanto isso, explore as conexões abaixo.</p></div>` : '';

  const corpo = `
<article class="pagina" data-id="${p.id}">
  <header class="heroi">
    <div class="heroi-arte">${m.ilustracao ? `<img src="${U('/assets/ilustracoes/' + m.ilustracao)}" alt="${esc(m.ilustracaoAlt || m.titulo)}">` : arte(p.id, s.hue, { tam: 420, simbolo: s.simbolo })}</div>
    <div class="heroi-txt">
      <nav class="migalhas" aria-label="Você está em"><a href="${U('/')}">Início</a> / ${p.tipo === 'subtema' ? `<a href="${U('/' + s.id + '/')}">${esc(s.titulo)}</a> / ` : `<span>Portal ${String(s.ordem).padStart(2, '0')}</span> / `}<span aria-current="page">${esc(m.titulo)}</span></nav>
      <span class="eixo" style="--h:${s.hue}">${esc(eixoDe[s.eixo].titulo)}</span>
      <h1>${esc(m.titulo)}</h1>
      <p class="resumo">${esc(m.resumo || '')}</p>
      ${p.preparacao ? '' : `<ul class="meta">${m.nivel ? `<li>${nivelNome[m.nivel] || esc(m.nivel)}</li>` : ''}<li>${tempoLeitura(p.palavras)} min de leitura</li><li>Atualizado em <time datetime="${m.atualizado || m.criado}">${dataBR(m.atualizado || m.criado)}</time></li>${m.versao ? `<li>v${m.versao}</li>` : ''}</ul>${(m.tradicoes || []).length ? `<p class="tradicoes">${m.tradicoes.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}`}
      ${trilhaInfo.map(({ t, i }) => `<p class="na-trilha">Trilha <a href="${U('/trilhas/#' + t.id)}">${esc(t.titulo)}</a> · passo ${i + 1} de ${t.passos.length}</p>`).join('')}
    </div>
  </header>
  <div class="pagina-corpo">
    ${tocHtml ? `<aside class="lateral">${tocHtml}</aside>` : ''}
    <div class="texto${tocHtml ? '' : ' texto-largo'}">
      ${prepHtml}
      ${corpoHtml}
      ${blocoSecao}
      ${quiz}
      <section class="conexoes" id="conexoes"><h2>Conexões na Teia</h2><p class="peq">Como <em>${esc(m.titulo)}</em> se liga aos outros temas. <a href="${U('/mapa/?foco=' + encodeURIComponent(p.id))}">Abrir no mapa interativo →</a></p>
        <div class="con-wrap">${cons.length ? constelacao(p, cons) : ''}<div class="con-listas">${listaCons('pai', 'Faz parte de')}${listaCons('filho', 'Subtemas')}${listaCons('relacionado', 'Temas relacionados')}${listaCons('cita', 'Citados aqui')}${listaCons('citado', 'Citado por')}${listaCons('irmao', 'Na mesma seção')}</div></div>
      </section>
      ${gloss}
      ${fontes}
      ${p.preparacao ? '' : `<div class="acoes-leitor"><button class="btn btn-estudado" data-id="${p.id}">✓ Marcar como estudado</button><a class="btn btn-sec" href="${ISSUE('sugestao-leitor.yml', { title: 'Sugestão: ' + m.titulo, pagina: ABS(p.url) })}" target="_blank" rel="noopener">Sugerir melhoria</a><a class="btn btn-sec" href="${ISSUE('reportar-problema.yml', { title: 'Problema: ' + m.titulo, pagina: ABS(p.url) })}" target="_blank" rel="noopener">Reportar erro</a></div>`}
      <nav class="seq" aria-label="Continuar a jornada">${ant ? `<a class="seq-ant" href="${U(ant.url)}"><span>← Anterior</span>${esc(ant.meta.titulo)}</a>` : '<span></span>'}${prox ? `<a class="seq-prox" href="${U(prox.url)}"><span>Próximo →</span>${esc(prox.meta.titulo)}</a>` : ''}</nav>
    </div>
  </div>
</article>`;

  const jsonld = p.preparacao ? null : { '@context': 'https://schema.org', '@type': 'Article', headline: m.titulo, description: m.resumo, datePublished: m.criado, dateModified: m.atualizado || m.criado, inLanguage: 'pt-BR', mainEntityOfPage: ABS(p.url), publisher: { '@type': 'Organization', name: cfg.nome }, author: { '@type': 'Organization', name: cfg.nome }, about: m.tradicoes, keywords: (m.palavrasChave || []).join(', ') };
  escrever(p.id + '/index.html', layout({ titulo: m.titulo, descricao: m.resumo || s.resumo, caminho: p.url, corpo, hue: s.hue, jsonld, tipoOG: 'article', noindex: !!p.preparacao }));
}

// ---------------- 7. Página inicial ----------------
const recentes = [...publicadas].sort((a, b) => (b.meta.atualizado || b.meta.criado || '').localeCompare(a.meta.atualizado || a.meta.criado || '')).slice(0, 6);
const portais = secoes.map((s) => {
  const p = paginas.get(s.id); const subs = publicadas.filter((q) => q.secao === s.id && q.tipo === 'subtema').length;
  return cartao(p, `<span class="cartao-rodape">${p.preparacao ? 'Em preparação' : `${subs} subtema${subs === 1 ? '' : 's'}`} · ${esc(eixoDe[s.eixo].titulo)}</span>`);
}).join('');
const home = `
<section class="abertura">
  <div class="abertura-arte" aria-hidden="true">${arte('teia-universal-inicio', 268, { tam: 560 })}</div>
  <div class="abertura-txt">
    <p class="sobretitulo">Enciclopédia viva · ${publicadas.length} páginas · ${secoes.length} portais</p>
    <h1>Tudo está conectado.<br><em>Explore a Teia.</em></h1>
    <p class="lead">${esc(cfg.descricao)}</p>
    <div class="cta"><a class="btn" href="${U('/trilhas/')}">Começar pela trilha inicial</a><a class="btn btn-sec" href="${U('/mapa/')}">Ver o mapa de conexões</a></div>
  </div>
</section>
<section class="faixa eixos-faixa"><h2 class="tit-sec">Sete eixos, ${secoes.length} portais</h2><ul class="eixos">${eixos.map((e) => `<li style="--h:${e.cor}"><span></span>${esc(e.titulo)}</li>`).join('')}</ul></section>
<section class="faixa"><h2 class="tit-sec">Os portais da Teia</h2><p class="sub-sec">Na ordem sugerida de estudo — da origem de tudo à prática espiritual.</p><div class="grade">${portais}</div></section>
${anuncio()}
<section class="faixa"><h2 class="tit-sec">Atualizados recentemente</h2><div class="grade grade-sub">${recentes.map((p) => cartao(p, `<span class="cartao-rodape">Atualizado em ${dataBR(p.meta.atualizado || p.meta.criado)}</span>`)).join('')}</div><p><a href="${U('/novidades/')}">Todas as novidades →</a></p></section>
<section class="faixa trilhas-home"><h2 class="tit-sec">Trilhas de estudo</h2><div class="grade grade-trilhas">${trilhas.map((t) => `<a class="trilha-card" href="${U('/trilhas/#' + t.id)}"><span class="rotulo">${nivelNome[t.nivel]}</span><h3>${esc(t.titulo)}</h3><p>${esc(t.descricao)}</p><span class="cartao-rodape">${t.passos.length} passos</span></a>`).join('')}</div></section>
<section class="faixa metodo"><h2 class="tit-sec">Como a Teia funciona</h2><div class="grade grade-3"><div><h3>Visão das tradições</h3><p>Cada tema apresenta o que ensinam as diferentes correntes — Lei do Um, Teosofia, Espiritismo, tradições orientais, ciência — indicando a origem de cada ideia.</p></div><div><h3>Tudo interligado</h3><p>Links, relações e citações formam uma rede: cada página mostra de onde vem, para onde leva e quem a cita.</p></div><div><h3>Sempre atualizada</h3><p>As páginas são revisadas e aprofundadas continuamente. A data de atualização aparece em cada uma.</p></div></div></section>`;
escrever('index.html', layout({ titulo: cfg.nome, descricao: cfg.descricao, caminho: '/', corpo: home, hue: 268, jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.nome, url: ABS('/'), inLanguage: 'pt-BR', potentialAction: { '@type': 'SearchAction', target: ABS('/busca/') + '?q={q}', 'query-input': 'required name=q' } } }));

// ---------------- 8. Mapa interativo ----------------
const nosGrafo = [...paginas.values()].map((p) => ({ id: p.id, t: p.meta.titulo, u: U(p.url), h: secaoDe[p.secao].hue, tipo: p.tipo, s: p.secao, prep: !!p.preparacao, e: secaoDe[p.secao].eixo }));
const linksGrafo = []; const vistos = new Set();
for (const p of paginas.values()) for (const c of conexoes(p)) {
  const k = [p.id, c.id].sort().join('|'); if (vistos.has(k)) continue; vistos.add(k);
  linksGrafo.push({ source: p.id, target: c.id, tipo: c.tipos.includes('pai') || c.tipos.includes('filho') ? 'hierarquia' : c.tipos.some((t) => t.startsWith('cit')) ? 'citacao' : 'relacao' });
}
escrever('grafo.json', JSON.stringify({ nodes: nosGrafo, links: linksGrafo, eixos }));
escrever('mapa/index.html', layout({ titulo: 'Mapa de conexões', descricao: 'Mapa interativo que mostra como todos os temas espiritualistas da Teia Universal se conectam.', caminho: '/mapa/', hue: 200, corpo: `
<section class="mapa-pagina"><div class="mapa-topo"><div><h1>Mapa de conexões</h1><p class="peq">${nosGrafo.length} temas · ${linksGrafo.length} conexões. Arraste, aproxime com a roda do mouse ou com dois dedos, clique para abrir.</p></div>
<div class="mapa-ctrl"><input type="search" id="mapa-filtro" placeholder="Destacar tema…" aria-label="Destacar tema"><label><input type="checkbox" id="mapa-prep" checked> Mostrar em preparação</label></div></div>
<ul class="eixos eixos-mini">${eixos.map((e) => `<li style="--h:${e.cor}"><span></span>${esc(e.titulo)}</li>`).join('')}<li class="leg-l"><i class="l-h"></i>hierarquia</li><li class="leg-l"><i class="l-r"></i>relação</li><li class="leg-l"><i class="l-c"></i>citação</li></ul>
<div id="mapa" class="mapa"><noscript>O mapa precisa de JavaScript. Use o menu Temas para navegar.</noscript></div>
<div id="mapa-info" class="mapa-info" hidden></div></section>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js" defer></script>
<script src="${U('/assets/mapa.js')}" defer></script>` }));

// ---------------- 9. Glossário, trilhas, busca, novidades ----------------
const termos = [...glossario.values()].sort((a, b) => a.termo.localeCompare(b.termo, 'pt'));
const letras = [...new Set(termos.map((t) => semAcento(t.termo)[0].toUpperCase()))];
escrever('glossario/index.html', layout({ titulo: 'Glossário espiritualista', descricao: `Glossário com ${termos.length} termos espiritualistas explicados com clareza: ${termos.slice(0, 6).map((t) => t.termo).join(', ')} e mais.`, caminho: '/glossario/', hue: 42, corpo: `
<section class="simples"><h1>Glossário</h1><p class="lead">${termos.length} termos explicados, cada um ligado à página onde é aprofundado.</p><input type="search" class="filtro-gl" placeholder="Filtrar termos…" aria-label="Filtrar termos"><nav class="letras">${letras.map((l) => `<a href="#l-${l}">${l}</a>`).join('')}</nav>
${letras.map((l) => `<h2 id="l-${l}">${l}</h2><dl class="gl-lista">${termos.filter((t) => semAcento(t.termo)[0].toUpperCase() === l).map((t) => `<div class="gl-item" id="t-${slugify(t.termo)}"><dt>${esc(t.termo)}</dt><dd>${esc(t.definicao)} <a href="${U(paginas.get(t.origem).url)}">Em: ${esc(paginas.get(t.origem).meta.titulo)} →</a></dd></div>`).join('')}</dl>`).join('')}</section>` }));

escrever('trilhas/index.html', layout({ titulo: 'Trilhas de estudo', descricao: 'Roteiros de estudo espiritualista do iniciante ao avançado, com progresso salvo no seu navegador.', caminho: '/trilhas/', hue: 320, corpo: `
<section class="simples"><h1>Trilhas de estudo</h1><p class="lead">Roteiros em ordem, do mais simples ao mais profundo. Marque cada página como estudada — seu progresso fica salvo neste navegador.</p>
${trilhas.map((t) => `<div class="trilha" id="${t.id}" data-passos="${t.passos.join(',')}"><div class="trilha-cab"><span class="rotulo">${nivelNome[t.nivel]}</span><h2>${esc(t.titulo)}</h2><p>${esc(t.descricao)}</p><div class="barra"><span></span></div><p class="peq trilha-prog">0 de ${t.passos.length} estudados</p></div><ol>${t.passos.map((id) => { const p = paginas.get(id); if (!p) { AVISO(`trilha ${t.id}: passo "${id}" não existe`); return ''; } return `<li data-id="${id}"><a href="${U(p.url)}"${p.preparacao ? ' class="prep"' : ''}>${esc(p.meta.titulo)}</a>${p.preparacao ? ' <span class="peq">(em preparação)</span>' : ''}</li>`; }).join('')}</ol></div>`).join('')}</section>` }));

const indiceBusca = [...paginas.values()].map((p) => ({ t: p.meta.titulo, u: U(p.url), r: p.meta.resumo || '', s: secaoDe[p.secao].titulo, k: [...(p.meta.palavrasChave || []), ...(p.meta.tradicoes || []), ...(p.toc || []).map((x) => x.texto), ...(p.meta.glossario || []).map((g) => g.termo)].join(' '), x: p.textoBusca || '' }))
  .concat(termos.map((t) => ({ t: t.termo, u: U('/glossario/#t-' + slugify(t.termo)), r: t.definicao, s: 'Glossário', k: '', x: '' })));
escrever('busca.json', JSON.stringify(indiceBusca));
escrever('busca/index.html', layout({ titulo: 'Busca', descricao: 'Busque qualquer tema, termo ou tradição na Teia Universal.', caminho: '/busca/', hue: 200, noindex: true, corpo: `<section class="simples"><h1>Busca</h1><input type="search" id="busca-pagina" class="filtro-gl" placeholder="Digite um tema, termo ou tradição…" aria-label="Buscar" autofocus><ul class="busca-res busca-res-pagina"></ul></section>` }));

const novidades = [...publicadas].sort((a, b) => (b.meta.atualizado || b.meta.criado || '').localeCompare(a.meta.atualizado || a.meta.criado || ''));
escrever('novidades/index.html', layout({ titulo: 'Novidades', descricao: 'Páginas publicadas e atualizadas recentemente na Teia Universal.', caminho: '/novidades/', hue: 170, corpo: `<section class="simples"><h1>Novidades</h1><p class="lead">A Teia cresce e se atualiza continuamente.</p><ul class="lista-novidades">${novidades.map((p) => `<li><time>${dataBR(p.meta.atualizado || p.meta.criado)}</time><a href="${U(p.url)}">${esc(p.meta.titulo)}</a><span class="peq">${esc(secaoDe[p.secao].titulo)}${p.meta.versao > 1 ? ` · revisão ${p.meta.versao}` : ' · nova'}</span></li>`).join('')}</ul></section>` }));

// ---------------- 10. Páginas institucionais (exigidas pelo AdSense) ----------------
const inst = (rota, titulo, descricao, html) => escrever(rota.slice(1) + 'index.html', layout({ titulo, descricao, caminho: rota, hue: 260, corpo: `<section class="simples texto-inst"><h1>${titulo}</h1>${html}</section>` }));
inst('/sobre/', 'Sobre e método', 'Conheça a Teia Universal, seu método editorial e como o conteúdo é produzido e atualizado.', `
<p class="lead">A Teia Universal é uma enciclopédia espiritualista viva: organiza grandes temas — da Fonte Criadora às dimensões, do Eu Superior aos Registros Akáshicos — e mostra como eles se conectam.</p>
<h2>Nosso método</h2><ul><li><strong>Visão das tradições.</strong> Apresentamos o que cada corrente ensina (Lei do Um, Teosofia, Espiritismo, Hinduísmo, Budismo, Cabala, Hermetismo, materiais canalizados) e indicamos a fonte de cada ideia. Não afirmamos como fato científico aquilo que pertence ao campo da fé ou da experiência.</li><li><strong>Ciência ao lado.</strong> Quando um tema toca a astronomia, a física ou a neurociência, trazemos o que a ciência atual diz, em caixas próprias.</li><li><strong>Interligação.</strong> Cada página declara suas conexões; o sistema calcula automaticamente quem cita quem e desenha o mapa da Teia.</li><li><strong>Atualização contínua.</strong> As páginas são revisadas, ampliadas e versionadas. A data e a versão aparecem no topo de cada uma.</li></ul>
<h2>Como o conteúdo é produzido</h2><p>Os textos são pesquisados e redigidos com auxílio de inteligência artificial (Claude, da Anthropic), seguindo um guia editorial próprio, e revisados sob a curadoria do editor do projeto. Encontrou um erro? Use o botão <em>Reportar erro</em> no fim de qualquer página.</p>
<h2>Aviso</h2><p>O conteúdo tem caráter educativo e informativo. Não substitui orientação médica, psicológica, jurídica ou religiosa.</p>`);
inst('/contato/', 'Contato', 'Fale com a Teia Universal: sugestões, correções e parcerias.', `<p>Quer sugerir um tema, apontar uma correção ou propor uma parceria? Escolha um canal:</p><div class="cta"><a class="btn" href="${ISSUE('sugestao-leitor.yml')}" target="_blank" rel="noopener">Sugerir tema ou melhoria</a><a class="btn btn-sec" href="${ISSUE('reportar-problema.yml')}" target="_blank" rel="noopener">Reportar um erro</a></div><p class="peq">Os formulários usam o GitHub (cadastro gratuito). Respondemos o mais rápido possível.</p>`);
inst('/privacidade/', 'Política de privacidade e cookies', 'Como a Teia Universal trata dados, cookies e publicidade, em conformidade com a LGPD.', `
<p>Última atualização: ${dataBR(HOJE)}.</p>
<h2>Dados que coletamos</h2><p>Este site não tem cadastro e não pede dados pessoais. Seu progresso nas trilhas e as páginas marcadas como estudadas ficam salvos <strong>apenas no seu navegador</strong> (armazenamento local) e nunca são enviados a nós.</p>
<h2>Cookies e publicidade</h2><p>Usamos o Google AdSense para exibir anúncios. O Google e seus parceiros podem usar cookies para exibir anúncios com base em suas visitas anteriores a este e a outros sites. Você pode desativar a publicidade personalizada nas <a href="https://adssettings.google.com" target="_blank" rel="noopener">Configurações de anúncios do Google</a> e saber mais em <a href="https://policies.google.com/technologies/ads?hl=pt-BR" target="_blank" rel="noopener">Como o Google usa cookies em publicidade</a>.</p>
<p>Podemos usar ferramentas de estatística (como o Google Analytics) para entender, de forma agregada, quais páginas são mais lidas.</p>
<h2>Seus direitos (LGPD)</h2><p>Você pode solicitar informações sobre o tratamento de dados, bem como bloquear cookies nas configurações do seu navegador. Para dúvidas, use a página de <a href="${U('/contato/')}">contato</a>.</p>
<h2>Serviços de terceiros</h2><p>O site é hospedado no GitHub Pages e carrega fontes do Google Fonts e bibliotecas do cdnjs (Cloudflare), que podem registrar dados técnicos de acesso (como endereço IP) conforme suas próprias políticas.</p>`);
inst('/termos/', 'Termos de uso', 'Termos de uso do conteúdo da Teia Universal.', `<p>O conteúdo da Teia Universal tem finalidade educativa e apresenta crenças e ensinamentos de diferentes tradições, sem endossá-los como fatos comprovados. Você pode citar trechos com link para a página de origem. Reprodução integral exige autorização. Não nos responsabilizamos por decisões tomadas com base no conteúdo, que não substitui aconselhamento profissional.</p>`);

// ---------------- 11. Painel do editor ----------------
const filaPend = fila.filter((f) => f.status !== 'publicado');
const proximos = [...filaPend].sort((a, b) => (b.prioridade === 'alta') - (a.prioridade === 'alta')).slice(0, 8);
escrever('painel/index.html', layout({ titulo: 'Painel do editor', descricao: 'Painel de controle da Teia Universal.', caminho: '/painel/', hue: 42, noindex: true, corpo: `
<section class="simples painel"><h1>Painel do editor</h1><p class="lead">Tudo o que você precisa para governar a Teia. Os pedidos são processados automaticamente pelo Claude todos os dias — só os feitos pela sua conta (ou que você aprovar com o rótulo <code>aprovado</code>).</p>
<div class="painel-acoes">
<a class="acao" href="${ISSUE('novo-tema.yml')}" target="_blank" rel="noopener"><b>＋</b><span><strong>Adicionar tema ou subtema</strong>O Claude pesquisa, escreve, ilustra e interliga.</span></a>
<a class="acao" href="${ISSUE('melhorar-pagina.yml')}" target="_blank" rel="noopener"><b>✎</b><span><strong>Editar ou melhorar página</strong>Aprofundar, corrigir, mudar tom, novas seções.</span></a>
<a class="acao" href="${ISSUE('atualizar-tema.yml')}" target="_blank" rel="noopener"><b>↻</b><span><strong>Atualizar tema agora</strong>Revisão completa com novidades e mais conexões.</span></a>
<a class="acao" href="${ISSUE('reportar-problema.yml')}" target="_blank" rel="noopener"><b>⚕</b><span><strong>Reportar problema</strong>Algo quebrado? O Claude diagnostica e corrige.</span></a>
<a class="acao" href="https://github.com/${cfg.repo}/actions/workflows/diagnostico.yml" target="_blank" rel="noopener"><b>✚</b><span><strong>Rodar diagnóstico</strong>Clique em "Run workflow" para checar tudo agora.</span></a>
<a class="acao" href="https://github.com/${cfg.repo}/issues" target="_blank" rel="noopener"><b>☰</b><span><strong>Ver pedidos</strong>Acompanhe o que está na fila e o que foi feito.</span></a>
</div>
<div class="painel-grade">
<div class="painel-box"><h2>Saúde do site</h2><div id="saude"><p class="peq">Carregando diagnóstico…</p></div></div>
<div class="painel-box"><h2>Números</h2><ul class="nums"><li><b>${publicadas.length}</b>páginas publicadas</li><li><b>${filaPend.length}</b>na fila</li><li><b>${linksGrafo.length}</b>conexões</li><li><b>${termos.length}</b>termos no glossário</li><li><b>${secoes.filter((s) => paginas.get(s.id).preparacao).length}</b>portais em preparação</li><li><b>${publicadas.reduce((a, p) => a + p.palavras, 0).toLocaleString('pt-BR')}</b>palavras</li></ul></div>
<div class="painel-box"><h2>Próximos na fila</h2><ol>${proximos.map((f) => `<li>${esc(f.titulo)} <span class="peq">${f.prioridade === 'alta' ? '· prioridade' : ''}</span></li>`).join('')}</ol></div>
<div class="painel-box"><h2>Publicação</h2><ul class="painel-lista"><li>Ritmo automático: <b>1 página nova ou revisada por dia</b></li><li>AdSense: <b>${cfg.adsenseClient ? 'ativo' : 'aguardando código ca-pub'}</b></li><li>Último build: <b>${dataBR(HOJE)}</b></li></ul></div>
</div></section>
<script>fetch('${U('/diagnostico.json')}').then(r=>r.json()).then(d=>{const el=document.getElementById('saude');const li=(a,c)=>a.slice(0,12).map(x=>'<li class="'+c+'">'+x.replace(/</g,'&lt;')+'</li>').join('');el.innerHTML='<p class="saude-'+(d.erros.length?'ruim':d.avisos.length?'media':'boa')+'">'+(d.erros.length?d.erros.length+' erro(s) — o Claude corrige no próximo ciclo':d.avisos.length?'Funcionando, com '+d.avisos.length+' ponto(s) a melhorar':'Tudo perfeito ✓')+'</p><ul class="diag">'+li(d.erros,'e')+li(d.avisos,'a')+li(d.dicas,'d')+'</ul>'}).catch(()=>{document.getElementById('saude').textContent='Diagnóstico indisponível.'})</script>` }));

// ---------------- 12. Arquivos técnicos ----------------
const urlsSitemap = [{ u: '/', d: HOJE }, ...publicadas.map((p) => ({ u: p.url, d: p.meta.atualizado || p.meta.criado || HOJE })), ...['/mapa/', '/trilhas/', '/glossario/', '/novidades/', '/sobre/', '/contato/', '/privacidade/', '/termos/'].map((u) => ({ u, d: HOJE }))];
escrever('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlsSitemap.map((x) => `<url><loc>${ABS(x.u)}</loc><lastmod>${x.d}</lastmod></url>`).join('')}</urlset>`);
escrever('robots.txt', `User-agent: *\nAllow: /\nDisallow: ${U('/painel/')}\nSitemap: ${ABS('/sitemap.xml')}\n`);
if (cfg.adsenseClient) escrever('ads.txt', `google.com, ${cfg.adsenseClient.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
escrever('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(cfg.nome)}</title><link>${ABS('/')}</link><description>${esc(cfg.slogan)}</description><language>pt-br</language>${novidades.slice(0, 30).map((p) => `<item><title>${esc(p.meta.titulo)}</title><link>${ABS(p.url)}</link><guid>${ABS(p.url)}#v${p.meta.versao || 1}</guid><pubDate>${new Date(p.meta.atualizado || p.meta.criado || HOJE).toUTCString()}</pubDate><description>${esc(p.meta.resumo || '')}</description></item>`).join('')}</channel></rss>`);
escrever('404.html', layout({ titulo: 'Página não encontrada', descricao: 'Página não encontrada.', caminho: '/404.html', noindex: true, corpo: `<section class="simples"><h1>Este fio da Teia ainda não existe</h1><p class="lead">A página que você procura não foi encontrada — talvez ainda esteja sendo escrita.</p><div class="cta"><a class="btn" href="${U('/')}">Voltar ao início</a><a class="btn btn-sec" href="${U('/busca/')}">Buscar</a></div></section>` }));
escrever('.nojekyll', '');
// copiar assets
fs.cpSync(path.join(RAIZ, 'assets'), path.join(OUT, 'assets'), { recursive: true });
if (fs.existsSync(path.join(RAIZ, 'CNAME'))) fs.copyFileSync(path.join(RAIZ, 'CNAME'), path.join(OUT, 'CNAME'));

// links internos quebrados (verificação final)
const existentes = new Set();
const varrer = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) varrer(p); else existentes.add('/' + path.relative(OUT, p).split(path.sep).join('/')); } };
varrer(OUT);
for (const f of existentes) if (f.endsWith('.html')) {
  const html = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const [, href] of html.matchAll(/href="([^"#?]+)/g)) {
    if (!href.startsWith(BASE + '/') && !(BASE === '' && href.startsWith('/'))) continue;
    const alvo = href.slice(BASE.length); const alvoArq = alvo.endsWith('/') ? alvo + 'index.html' : alvo;
    if (!existentes.has(alvoArq)) ERRO(`Link quebrado em ${f}: ${href}`);
  }
}

const relatorio = { geradoEm: new Date().toISOString(), paginas: publicadas.length, fila: filaPend.length, ...diag };
escrever('diagnostico.json', JSON.stringify(relatorio, null, 1));
escrever('status.json', JSON.stringify({ publicadas: publicadas.map((p) => ({ id: p.id, titulo: p.meta.titulo, atualizado: p.meta.atualizado || p.meta.criado, versao: p.meta.versao || 1, palavras: p.palavras })), filaPendente: filaPend.map((f) => f.id) }, null, 1));

console.log(`\n✦ Teia Universal — ${publicadas.length} páginas publicadas, ${paginas.size - publicadas.length} portais em preparação, ${linksGrafo.length} conexões, ${termos.length} termos.`);
console.log(`  Diagnóstico: ${diag.erros.length} erro(s), ${diag.avisos.length} aviso(s), ${diag.dicas.length} dica(s).`);
for (const e of diag.erros) console.log('  ✖ ' + e);
for (const a of diag.avisos) console.log('  ⚠ ' + a);
if (process.argv.includes('--check') && diag.erros.length) process.exit(1);
