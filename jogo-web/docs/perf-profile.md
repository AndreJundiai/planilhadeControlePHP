# Perfil de desempenho — Auto Theft Jundiaí (2026-11-21)

Método da skill `/perf-profile` (Claude Code Game Studios): medir antes de concluir; o que não tem dado é
**NÃO AVALIADO**, não "aprovado". Medidor no jogo: tecla **F3** (ms por sistema, chamadas de desenho, triângulos).

## Dados medidos
Ambiente: Chromium sem placa de vídeo (SwiftShader, desenho feito pelo processador), 1280×720, gráfico **Médio**,
cidade de teste, André andando por 10 s. Médias móveis do medidor `src/core/Profiler.js`.

| Sistema | ms/quadro |
|---|---|
| jogador (entrada + movimento) | 0,52 |
| física (Rapier) | 0,94 |
| trânsito | 0,35 |
| pedestres (IA) | 0,47 |
| polícia/procurado | 0,01 |
| mundo (blocos do mapa, LOD) | 0,56 |
| HUD | 0,23 |
| multidão (instâncias + realistas) | 0,34 |
| **lógica total** | **~3,4** |
| desenho (envio para a GPU) | 29,5 *(SwiftShader — não representa GPU real)* |

Chamadas de desenho: **90** · Triângulos: **222 mil** (≈ 190 mil são os modelos realistas, 21,5 mil cada).

## Conclusões
1. A lógica do jogo cabe folgada no orçamento de 16,7 ms (60 FPS): ~3,4 ms.
2. O custo está no **desenho**, puxado pelos triângulos dos modelos realistas.

## Ações tomadas
- LOD dos realistas: só até **35 m** (era 55 m). Celular: no máximo 2; Baixo 4; Médio 8; Alto 14.
- Teste de fumaça no CI (`tests/smoke.cjs`): o APK só é publicado se o caminho principal passar.

## NÃO AVALIADO — sem dados
- **FPS e tempo de GPU em celular real** — precisa rodar o APK num aparelho e ler o F3/⚙.
- **Memória** ao longo de uma sessão longa (vazamentos ao carregar/descartar blocos) — precisa de `/soak-test`.
- **Mapa real de Jundiaí** (mais prédios que a cidade de teste) — os servidores de mapa são bloqueados neste ambiente.

## Próximos passos recomendados (por impacto esperado)
1. Medir no celular real; se < 30 FPS no Baixo, reduzir resolução (0,6) e tirar o pós-processamento de cor.
2. Versão "leve" do modelo realista (~6 mil triângulos) para os NPCs; o detalhado só para o André.
3. Juntar as malhas de cada bloco do mapa em menos chamadas (paredes + telhados + calçadas).

## 2026-11-27 — caça às travadas (picos de quadro)

Medido dirigindo e carregando 25 quarteirões seguidos na cidade de teste (gráfico Baixo, PC sem GPU; os tempos de CPU valem como comparação):

| O que travava | Antes | Depois | Correção |
|---|---|---|---|
| Shader compilado durante o jogo | 25 compilações; pior travada de 722 ms | 0 compilações | pré-aquecimento na tela de título: todos os carros, a viatura com sirene, pessoas realistas, totem, partículas e objetos escondidos, de dia e de noite, com sombras. As roupas das pessoas realistas viraram um shader só (antes, um por combinação de cores) |
| Postes, semáforos e faixas de cada quarteirão (thread principal) | 11–56 ms (média 23 ms) | 1,5–6 ms | cálculo levado para o Web Worker; o `append` passou a copiar vértices sem Vector3/Matrix |
| Tarefas longas (> 50 ms) no percurso | 2–3 (722, 77, 66 ms) | 0 | — |

Ferramentas: `F3` ou Pausa → "Medidor de desempenho" mostra FPS, pior quadro e ms por sistema; `game.prof.spikes` lista os quadros lentos e o que pesou neles; `game.streamer.buildStats` mostra o custo de cada etapa da montagem dos quarteirões.

### Com a CPU 4× mais lenta (simulando um celular)

| Por quadro | Antes | Depois | Correção |
|---|---|---|---|
| Trânsito | 31 ms | 0,6 ms | no máximo 1 carro reaparece por quadro; A* de rota limitado a 2.500 nós (antes até 30 mil, varrendo a cidade quando o destino ficava num pedaço desconectado) |
| Pedestres | 46 ms | 1 ms | no máximo 2 reaparecem por quadro (teste de regressão no `smoke`) |
| "Mundo" (tarefas a cada 0,4 s) | até 15 ms num quadro | ~2 ms | uma tarefa por quadro em rodízio; quarteirões continuam sendo pedidos por tempo |
