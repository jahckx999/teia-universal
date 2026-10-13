/* Teia Universal — interatividade */
(() => {
  const BASE = document.body.dataset.base || '';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const guardar = { ler(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  // ---- Menu de temas ----
  const mm = $('#megamenu'); const bt = $('.nav-temas'); const bm = $('.btn-menu');
  const abrirMenu = (abrir) => { mm.hidden = !abrir; bt && bt.setAttribute('aria-expanded', abrir); bm && bm.setAttribute('aria-expanded', abrir); };
  bt && bt.addEventListener('click', () => abrirMenu(mm.hidden));
  bm && bm.addEventListener('click', () => abrirMenu(mm.hidden));
  document.addEventListener('click', (e) => { if (!mm.hidden && !e.target.closest('.topo')) abrirMenu(false); });

  // ---- Busca ----
  let indice = null;
  const carregar = async () => indice || (indice = await fetch(BASE + '/busca.json').then((r) => r.json()).catch(() => []));
  const buscar = (q) => {
    const termos = norm(q).split(/\s+/).filter(Boolean); if (!termos.length) return [];
    return indice.map((d) => {
      const t = norm(d.t), k = norm(d.k), r = norm(d.r), x = norm(d.x); let pts = 0;
      for (const w of termos) { if (t.includes(w)) pts += t.startsWith(w) ? 12 : 8; else if (k.includes(w)) pts += 5; else if (r.includes(w)) pts += 3; else if (x.includes(w)) pts += 1; else return null; }
      return { d, pts };
    }).filter(Boolean).sort((a, b) => b.pts - a.pts).slice(0, 12).map((x) => x.d);
  };
  const render = (ul, res, q) => { ul.innerHTML = res.length ? res.map((d, i) => `<li><a href="${d.u}"${i === 0 ? ' class="sel"' : ''}><b>${d.t}</b><small>${d.s} — ${d.r.slice(0, 110)}</small></a></li>`).join('') : (q ? '<li class="peq" style="padding:12px 14px">Nada encontrado. Que tal sugerir esse tema?</li>' : ''); };
  const ov = $('.busca-ov'); const inp = ov && $('input', ov); const ul = ov && $('.busca-res', ov);
  const abrirBusca = async () => { ov.hidden = false; inp.value = ''; ul.innerHTML = ''; inp.focus(); await carregar(); };
  const fecharBusca = () => { ov.hidden = true; };
  $('.btn-busca') && $('.btn-busca').addEventListener('click', abrirBusca);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
    else if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); abrirBusca(); }
    else if (e.key === 'Escape') { fecharBusca(); abrirMenu(false); }
  });
  if (ov) {
    ov.addEventListener('click', (e) => { if (e.target === ov) fecharBusca(); });
    inp.addEventListener('input', async () => { await carregar(); render(ul, buscar(inp.value), inp.value); });
    inp.addEventListener('keydown', (e) => {
      const links = $$('a', ul); let i = links.findIndex((a) => a.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); links[i] && links[i].classList.remove('sel'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links[i] && (links[i].classList.add('sel'), links[i].scrollIntoView({ block: 'nearest' })); }
      if (e.key === 'Enter' && links[i]) location.href = links[i].href;
    });
  }
  const bp = $('#busca-pagina');
  if (bp) {
    const ulp = $('.busca-res-pagina'); const q0 = new URLSearchParams(location.search).get('q') || '';
    const go = async () => { await carregar(); render(ulp, buscar(bp.value), bp.value); };
    bp.value = q0; bp.addEventListener('input', go); if (q0) go();
  }

  // ---- Glossário: dicas ----
  let dica = null;
  const mostrar = (el) => { esconder(); dica = document.createElement('div'); dica.className = 'dica-g'; dica.textContent = el.dataset.def; document.body.appendChild(dica); const r = el.getBoundingClientRect(); const w = Math.min(300, innerWidth - 24); dica.style.maxWidth = w + 'px'; dica.style.left = Math.max(12, Math.min(r.left + scrollX, scrollX + innerWidth - w - 12)) + 'px'; dica.style.top = r.bottom + scrollY + 8 + 'px'; };
  const esconder = () => { dica && dica.remove(); dica = null; };
  $$('dfn.g').forEach((el) => { el.addEventListener('mouseenter', () => mostrar(el)); el.addEventListener('mouseleave', esconder); el.addEventListener('focus', () => mostrar(el)); el.addEventListener('blur', esconder); el.addEventListener('click', (e) => { e.stopPropagation(); dica ? esconder() : mostrar(el); }); });
  document.addEventListener('scroll', esconder, { passive: true });

  // ---- Filtro do glossário ----
  const fg = $('.filtro-gl:not(#busca-pagina)');
  fg && fg.addEventListener('input', () => { const q = norm(fg.value); $$('.gl-item').forEach((it) => { it.hidden = q && !norm(it.textContent).includes(q); }); });

  // ---- Quiz ----
  $$('.quiz').forEach((qz) => {
    const total = $$('.q', qz).length; let resp = 0, certas = 0; const placar = $('.quiz-placar', qz);
    $$('.q', qz).forEach((q) => {
      const c = +q.dataset.correta;
      $$('button', q).forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i; $$('button', q).forEach((x) => { x.disabled = true; if (+x.dataset.i === c) x.classList.add('certa'); });
        if (i !== c) b.classList.add('errada'); else certas++;
        resp++; $('.q-exp', q).hidden = false;
        placar.textContent = resp < total ? `${resp} de ${total} respondidas · ${certas} certa(s)` : `Resultado: ${certas} de ${total} ${certas === total ? '— perfeito! ✦' : certas >= total / 2 ? '— muito bem!' : '— releia e tente de novo.'}`;
      }));
    });
  });

  // ---- Estudado / trilhas ----
  const lidos = new Set(guardar.ler('tu-lidos', []));
  const salvarLidos = () => guardar.gravar('tu-lidos', [...lidos]);
  $$('.btn-estudado').forEach((b) => {
    const id = b.dataset.id; const pinta = () => { const f = lidos.has(id); b.classList.toggle('feito', f); b.textContent = f ? '✓ Estudado' : '✓ Marcar como estudado'; };
    pinta(); b.addEventListener('click', () => { lidos.has(id) ? lidos.delete(id) : lidos.add(id); salvarLidos(); pinta(); });
  });
  $$('.trilha').forEach((t) => {
    const passos = t.dataset.passos.split(','); const feitos = passos.filter((p) => lidos.has(p)).length;
    $$('li[data-id]', t).forEach((li) => li.classList.toggle('feito', lidos.has(li.dataset.id)));
    $('.barra span', t).style.width = (feitos / passos.length) * 100 + '%';
    $('.trilha-prog', t).textContent = `${feitos} de ${passos.length} estudados`;
  });

  // ---- Sumário ativo ----
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const alvo = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const obs = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { tocLinks.forEach((a) => a.classList.remove('ativo')); alvo.get(e.target.id) && alvo.get(e.target.id).classList.add('ativo'); } }), { rootMargin: '-20% 0px -70% 0px' });
    alvo.forEach((_, id) => { const h = document.getElementById(id); h && obs.observe(h); });
  }
})();
