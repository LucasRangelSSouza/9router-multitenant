# Manual de atualização do 9Router (fork luar_ai_gateway)

Atualização **manual, sob demanda, uma vez por mês**. Nada atualiza sozinho. Este manual vale para o 9Router; o do Chatwoot está em `luar_chatwoot/docs/upgrade/CHATWOOT.md`. Visão geral e calendário: `CONTRATO.md` (mesmo conteúdo nos dois repositórios).

## Fatos de partida (22/10/2026)
- Fork da v0.5.55 do upstream `decolua/9router`; upstream na v0.5.104 na data. O fork nasceu como commit único, **sem histórico em comum**.
- Divergência nossa: 77 arquivos fora de docs e testes. Conflitos simulados no salto 0.5.55 → 0.5.104: 18 arquivos (isolamento: `db/schema.js`, `db/index.js`, `apiKeysRepo.js`, `localDb.js`, handlers `chat/fetch/search/imageGeneration`, rotas `keys`, `oauth`, `providers`, `v1/models`). Relatório: `specs/anexos/11/estudos/9router-upgrade-simulacao.md`.

## Pré-condições (todas obrigatórias)
1. Janela marcada (primeira terça do mês), outros deploys congelados.
2. Backup do banco do gateway **e restauração testada** em ambiente descartável: `/opt/platform/data/llm-gateway`.
3. Changelog do upstream lido; versão-alvo decidida.
4. A tela de provedores/combos do LUAR já mergeada (os mesmos arquivos entram no conflito).

## Passos
1. **Importar**: `git remote add upstream https://github.com/decolua/9router.git` (se faltar); `git fetch upstream --tags`; criar tags de referência `up-vX.Y.Z`. Na primeira vez, criar o commit-âncora: `git commit-tree HEAD^{tree} -p up-v0.5.55^{commit} -m "ancora"` e usar como base do merge.
2. **Branch** `upgrade/<versão>` a partir do `main`.
3. **Mesclar** `up-v<alvo>` na branch. Resolver os conflitos pelas regras:
   - arquivos de **isolamento** (marcador `LUAR-MT`): revisão obrigatória, manter a regra de `tenantId` e `MT_STRICT`;
   - arquivo apagado no upstream e modificado por nós: decidir caso a caso (registrar no log);
   - `package-lock.json`: regenerar;
   - o painel: manter ocultos "Update now", aviso de versão, Donate, 9Remote, 9English.
4. **Portões** (todos devem passar): `npm test` (inclui isolamento 5/5), `npm run build`, contrato de consumo do LUAR (`tests/luar-contract`), verificação de marcadores (`tools/verify_fork_extensions.js`).
5. **Banco**: rodar as migrações do upstream numa **cópia** do banco; conferir que nenhuma linha perdeu `tenantId` (`SELECT count(*) ... WHERE tenant_id IS NULL`).
6. **Ensaio**: subir a imagem nova ao lado (segunda porta, cópia do banco) e rodar a bateria: login do painel, listar provedores e combos por tenant, chave restrita a combo, criar tenant, cadastro de conta por OAuth e por chave de API, uma chamada real de modelo por tenant.
7. **Canário**: apontar um tenant de teste (chave por run) para a imagem nova.
8. **Release** oficial (workflow `Release` do repositório) → intake → `deploy.yml -f service=llm-gateway`. Rollback de imagem: digest anterior no lock. Rollback de dados: restauração do backup do passo 2.
9. **Vigilância** por 7 dias (erros 5xx, latência, `x-tenant-id` ausente).

## Abortar se
- qualquer teste de isolamento falhar;
- a migração não tiver volta e o backup não estiver validado;
- o contrato de consumo do LUAR quebrar sem correção no mesmo dia.

## Registro
Cada janela gera `UPGRADE_LOG_<ano-mês>.md` com versões, conflitos, tempo, testes, problemas e decisão (seguiu, adiou, reverteu).

## Achados do primeiro ensaio (22/10/2026)
O merge 0.5.55 → 0.5.104 foi ensaiado de verdade em branch descartável: 18 conflitos, dos quais 10 tocam o isolamento
e o controle de acesso por chave (o upstream criou o modelo `access`, equivalente ao nosso `allowedCombos`).
Antes do próximo ensaio: escrever os testes do contrato de consumo do LUAR no repositório do motor e decidir adaptar
`allowedCombos` → `access`. Relatório completo em `specs/anexos/11/estudos/9router-ensaio-merge-22-10.md`.
