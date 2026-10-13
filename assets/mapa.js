/* Teia Universal — mapa interativo de conexões (d3 force) */
(async () => {
  const BASE = document.body.dataset.base || '';
  const el = document.getElementById('mapa'); if (!el || !window.d3) return;
  const dados = await fetch(BASE + '/grafo.json').then((r) => r.json());
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const info = document.getElementById('mapa-info');
  const W = el.clientWidth, H = el.clientHeight;
  const grau = {}; dados.links.forEach((l) => { grau[l.source] = (grau[l.source] || 0) + 1; grau[l.target] = (grau[l.target] || 0) + 1; });
  const raio = (n) => (n.tipo === 'secao' ? 9 : 5) + Math.min(10, Math.sqrt(grau[n.id] || 0) * 2);
  const vizinhos = new Map(dados.nodes.map((n) => [n.id, new Set([n.id])]));
  dados.links.forEach((l) => { vizinhos.get(l.source).add(l.target); vizinhos.get(l.target).add(l.source); });
  // posição inicial em espiral seguindo a ordem dos portais
  const ordemSec = [...new Set(dados.nodes.map((n) => n.s))];
  dados.nodes.forEach((n) => { const k = ordemSec.indexOf(n.s); const a = (k / ordemSec.length) * Math.PI * 2; const r = 120 + k * 6; n.x = W / 2 + Math.cos(a) * r + Math.random() * 20; n.y = H / 2 + Math.sin(a) * r + Math.random() * 20; });

  const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, W, H]);
  const g = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);
  const corLink = { hierarquia: '#e9c67e', relacao: 'hsl(268 80% 75%)', citacao: 'hsl(190 80% 70%)' };
  const link = g.append('g').selectAll('line').data(dados.links).join('line')
    .attr('stroke', (d) => corLink[d.tipo]).attr('stroke-opacity', 0.35).attr('stroke-width', (d) => (d.tipo === 'hierarquia' ? 1.6 : 1)).attr('stroke-dasharray', (d) => (d.tipo === 'citacao' ? '4 3' : null));
  const no = g.append('g').selectAll('g').data(dados.nodes).join('g').style('cursor', 'pointer');
  no.append('circle').attr('r', raio).attr('fill', (d) => `hsl(${d.h} 80% ${d.tipo === 'secao' ? 68 : 58}%)`).attr('fill-opacity', (d) => (d.prep ? 0.3 : 0.95))
    .attr('stroke', (d) => `hsl(${d.h} 90% 85%)`).attr('stroke-width', (d) => (d.tipo === 'secao' ? 2 : 1)).style('filter', (d) => (d.tipo === 'secao' && !d.prep ? `drop-shadow(0 0 6px hsl(${d.h} 90% 65%))` : null));
  no.append('text').text((d) => d.t).attr('x', (d) => raio(d) + 4).attr('y', 4).style('font-size', (d) => (d.tipo === 'secao' ? '12px' : '10px')).style('opacity', (d) => (d.tipo === 'secao' ? 1 : 0.8));

  const sim = d3.forceSimulation(dados.nodes)
    .force('link', d3.forceLink(dados.links).id((d) => d.id).distance((l) => (l.tipo === 'hierarquia' ? 50 : 110)).strength((l) => (l.tipo === 'hierarquia' ? 0.8 : 0.15)))
    .force('carga', d3.forceManyBody().strength(-260))
    .force('centro', d3.forceCenter(W / 2, H / 2))
    .force('colisao', d3.forceCollide().radius((d) => raio(d) + 14))
    .on('tick', () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      no.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  no.call(d3.drag().on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  const destacar = (id) => {
    if (!id) { no.style('opacity', 1); link.attr('stroke-opacity', 0.35); return; }
    const v = vizinhos.get(id);
    no.style('opacity', (d) => (v.has(d.id) ? 1 : 0.12));
    link.attr('stroke-opacity', (l) => (l.source.id === id || l.target.id === id ? 0.95 : 0.04));
  };
  let fixo = null;
  no.on('mouseenter', (e, d) => { if (!fixo) destacar(d.id); }).on('mouseleave', () => { if (!fixo) destacar(null); })
    .on('click', (e, d) => {
      e.stopPropagation();
      if (fixo === d.id) { location.href = d.u; return; }
      fixo = d.id; destacar(d.id);
      const viz = [...vizinhos.get(d.id)].filter((x) => x !== d.id).map((x) => dados.nodes.find((n) => n.id === x));
      info.hidden = false;
      info.innerHTML = `<strong>${d.t}</strong>${d.prep ? ' <span class="peq">(em preparação)</span>' : ''} · <a href="${d.u}">Abrir página →</a><br><span class="peq">${viz.length} conexões: ${viz.slice(0, 14).map((n) => n.t).join(' · ')}${viz.length > 14 ? '…' : ''}</span><br><span class="peq">Dica: clique de novo no ponto para abrir.</span>`;
    });
  svg.on('click', () => { fixo = null; destacar(null); info.hidden = true; });

  const centrar = (d, escala = 1.6) => svg.transition().duration(800).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(escala).translate(-d.x, -d.y));
  const filtro = document.getElementById('mapa-filtro');
  filtro.addEventListener('input', () => {
    const q = norm(filtro.value);
    if (!q) { destacar(null); return; }
    const achado = dados.nodes.find((n) => norm(n.t).includes(q));
    no.style('opacity', (d) => (norm(d.t).includes(q) ? 1 : 0.15));
    if (achado) centrar(achado);
  });
  document.getElementById('mapa-prep').addEventListener('change', (e) => {
    const m = e.target.checked; no.style('display', (d) => (d.prep && !m ? 'none' : null));
    link.style('display', (l) => ((!m && (l.source.prep || l.target.prep)) ? 'none' : null));
  });
  const foco = new URLSearchParams(location.search).get('foco');
  if (foco) setTimeout(() => { const d = dados.nodes.find((n) => n.id === foco); if (d) { fixo = d.id; destacar(d.id); centrar(d); } }, 1600);
})();
