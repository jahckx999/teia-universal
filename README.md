# ✦ Teia Universal

Enciclopédia espiritualista viva: 24 portais (da Fonte Criadora à Espiritualidade), todos interligados, escritos e atualizados automaticamente pelo Claude.

**Site:** https://jahckx999.github.io/teia-universal/
**Painel do editor:** https://jahckx999.github.io/teia-universal/painel/

## Como governar (sem programar)

| Quero… | Faça |
|---|---|
| Adicionar um tema ou subtema | Painel → **Adicionar tema** |
| Melhorar ou corrigir uma página | Painel → **Editar ou melhorar** |
| Atualizar um tema já | Painel → **Atualizar tema agora** |
| Avisar de um problema | Painel → **Reportar problema** |
| Aprovar sugestão de leitor | Na issue, adicione o rótulo `aprovado` |
| Forçar o robô a rodar agora | No app do Claude, abra a tarefa agendada "Teia Universal — editor diário" e clique em **Executar agora** |

O Claude roda **todo dia**: processa seus pedidos, publica 1 página nova (ou revisa uma antiga), cruza as conexões e corrige o que o diagnóstico apontar. Toda segunda o GitHub faz um diagnóstico extra e abre uma issue se algo estiver errado — o robô corrige no ciclo seguinte.

## Ligar o AdSense

1. Tenha um **domínio próprio** (o AdSense não aprova endereços `github.io/pasta`). Ex.: `teiauniversal.com.br`.
2. Peça ao Claude: "ligar o domínio X na Teia" — ele cria o `CNAME` e ajusta `site.config.json` (`url` e `basePath: ""`).
3. Solicite o AdSense com o domínio. Ao receber o código `ca-pub-…`, peça: "colocar o AdSense ca-pub-… na Teia". O site passa a carregar os anúncios e o `ads.txt` automaticamente.

## Técnica (para o robô e curiosos)

`node scripts/build.mjs` gera o site em `_site/` (sem dependências). Manual completo do robô em [CLAUDE.md](CLAUDE.md).
