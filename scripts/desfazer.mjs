// Desfaz as alterações de um pedido já concluído (reverte os commits marcados com "#N").
// Roda no GitHub Actions quando o dono abre uma issue com o rótulo "desfazer".
import { execFileSync } from 'node:child_process';

const { CORPO = '', TITULO = '', NUM, GITHUB_REPOSITORY: REPO } = process.env;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const gh = (...a) => run('gh', [...a, '-R', REPO]);
const git = (...a) => run('git', a);
const comentar = (n, txt) => gh('issue', 'comment', String(n), '--body', txt);
const encerrar = (txt) => { comentar(NUM, txt); gh('issue', 'edit', NUM, '--add-label', 'feito'); gh('issue', 'close', NUM); };
const paraORobo = (motivo) => {
  comentar(NUM, `⏳ ${motivo}\n\nO Claude vai desfazer manualmente na próxima rodada (ou em até 2h se você marcou ⚡ Fazer agora).`);
  gh('issue', 'edit', NUM, '--add-label', 'aprovado');
  process.exit(0);
};

const alvo = ((TITULO + ' ' + CORPO).match(/#(\d+)/) || [])[1];
if (!alvo) paraORobo('Não encontrei o número do pedido a desfazer (ex.: #12).');
if (alvo === NUM) paraORobo('O pedido a desfazer não pode ser ele mesmo.');

// Commits do pedido: mensagem contendo "#N" (sem pegar #N0, #N1…), do mais novo para o mais antigo
const re = `#${alvo}([^0-9]|$)`;
const commits = git('log', '-E', `--grep=${re}`, '--format=%H').split('\n').filter(Boolean);
if (!commits.length) paraORobo(`Não achei alterações marcadas com #${alvo} no histórico.`);

// Segurança: só reverte conteúdo do site, nunca sistema/automação
const proibidos = /^(\.github\/|scripts\/|site\.config\.json$|CLAUDE\.md$)/;
for (const c of commits) {
  const arquivos = git('show', '--name-only', '--format=', c).split('\n').filter(Boolean);
  const ruim = arquivos.find((f) => proibidos.test(f));
  if (ruim) paraORobo(`O pedido #${alvo} mexeu em arquivo do sistema (${ruim}); por segurança, isso não é desfeito automaticamente.`);
}

try {
  for (const c of commits) git('revert', '--no-edit', '--no-commit', c);
  git('commit', '-m', `Desfazer: pedido #${alvo} (via pedido #${NUM})`);
} catch {
  try { git('revert', '--abort'); } catch {}
  paraORobo(`As alterações do pedido #${alvo} se misturaram com mudanças mais novas, então não dá para desfazer sozinho sem risco.`);
}

// Confere que o site continua montando antes de publicar
try { run('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' }); }
catch { paraORobo('Depois de desfazer, o site não passou na checagem; preferi não publicar.'); }

git('push', 'origin', 'HEAD:main');
gh('workflow', 'run', 'publicar.yml');
const lista = commits.map((c) => '`' + c.slice(0, 7) + '`').join(', ');
comentar(alvo, `↶ Alterações deste pedido desfeitas a pedido do Jackson (#${NUM}).`);
gh('issue', 'edit', alvo, '--add-label', 'desfeito');
encerrar(`✅ Pronto! Desfiz o pedido #${alvo} (${commits.length} alteração(ões): ${lista}). O site atualiza em ~1 minuto.\n\nMudou de ideia? Basta pedir de novo pela Central.`);
console.log('Desfeito:', alvo);
