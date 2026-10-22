# Contrato de atualização (Chatwoot e 9Router)

Regra do dono: **nenhum dos dois atualiza sozinho**. Atualização **manual, sob demanda, uma vez por mês**, com manual e contrato escritos e ensaiados.

## 1. Nada automático
- Chatwoot: `DISABLE_TELEMETRY=true`, banner de nova versão oculto, imagem por digest.
- 9Router: sem botão "Update now" nem aviso de versão no painel, sem merge automático do Dependabot (só alerta), imagem por digest.

## 2. Calendário
- Uma janela por mês (primeira terça), um componente por vez, outros deploys congelados.
- Fora de calendário só para falha de segurança grave, pelo mesmo processo.
- Registro por janela: `UPGRADE_LOG_<ano-mês>.md`.

## 3. Contrato de extensões (onde nosso código toca o núcleo)
- Chatwoot: `fork_extensions.yml` + `verify_fork_extensions` (já existe).
- 9Router: `fork_extensions.yml` + marcador `LUAR-MT` nos pontos de isolamento; o CI falha se um marcador sumir.

## 4. Contrato de comportamento (precisa passar em todo upgrade)
- Chatwoot: suíte de contrato do fork (permissões `ai.*`, ciclo de vida, proxy do Luar, Kanban, filas, marca, vocabulário proibido, flags de plano).
- 9Router: isolamento entre tenants (5/5) **mais** o contrato de consumo do LUAR: criar e suspender tenant, combos, chaves por combo, `providers_oauth/*`, chamada de modelo com chave restrita, cabeçalhos de administração.

## 5. Ensaiar o processo
O manual nasce do **primeiro ensaio** e só é aceito depois de um **segundo ensaio** que siga o manual ao pé da letra. Se faltar passo, corrige-se o manual e repete-se o ensaio. Meta: até 2 dias por componente na primeira vez, 1 dia depois; se estourar, reduzir os pontos de contato do fork.
