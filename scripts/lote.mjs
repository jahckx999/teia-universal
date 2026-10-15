// Divide um "pedido em lote" (uma linha por pedido) em issues separadas.
// Uso no GitHub Actions: node scripts/lote.mjs (lê CORPO, NUM, URGENTE, GITHUB_REPOSITORY)
import { execFileSync } from 'node:child_process';

const { CORPO = '', NUM, URGENTE, GITHUB_REPOSITORY: REPO } = process.env;
const gh = (...args) => execFileSync('gh', [...args, '-R', REPO], { encoding: 'utf8' }).trim();

const secao = (t) => {
  const s = CORPO.split(/^### /m).find((x) => x.startsWith(t));
  const v = s ? s.slice(t.length).trim() : '';
  return v === '_No response_' ? '' : v;
};
const TIPOS = { 'novo-tema': 'Tema novo', melhorar: 'Melhorar página', atualizar: 'Atualizar tema', problema: 'Problema', diagnostico: 'Diagnóstico' };
const pagina = secao('Página ou portal (opcional)');
const itens = secao('O que você quer?').split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => {
    const m = l.match(/^[-*]\s*\[([a-z-]+)\]\s*(.+)$/);
    const tipo = m && TIPOS[m[1]] ? m[1] : '';
    return { tipo, texto: (m ? m[2] : l.replace(/^[-*]\s*/, '')).trim() };
  })
  .filter((i) => i.texto.length > 2)
  .slice(0, 20);

const links = [];
for (const i of itens) {
  const labels = ['pedido', 'aprovado', i.tipo, URGENTE === 'true' && 'urgente'].filter(Boolean).join(',');
  const titulo = 'Pedido: ' + (i.tipo ? TIPOS[i.tipo] + ' — ' : '') + i.texto.slice(0, 70);
  const corpo = `### O que você quer?\n\n${i.texto}${pagina ? `\n\n### Página ou portal\n\n${pagina}` : ''}\n\n_Criado a partir do pedido em lote #${NUM}._`;
  links.push(gh('issue', 'create', '--title', titulo, '--label', labels, '--body', corpo));
}

gh('issue', 'comment', NUM, '--body', `✅ Dividi este lote em **${links.length} pedidos separados**. Cada um aparece no status do painel:\n\n${links.map((l) => '- ' + l).join('\n')}`);
gh('issue', 'edit', NUM, '--add-label', 'feito');
gh('issue', 'close', NUM);
console.log(`${links.length} pedidos criados.`);
