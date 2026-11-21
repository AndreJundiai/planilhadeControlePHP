## Performance Profile: Full — Auto Theft Jundiaí
Generated: 2026-11-21 · `performance.enforce: warn` (default) · commit `b8966d1`

### Entradas
| Entrada | Status |
|---|---|
| Budgets em `project.yaml` (`performance.*`) | ABSENT — o usuário optou por não definir |
| Medição em tempo de execução (`src/core/Profiler.js`, F3) | FOUND — Chromium/SwiftShader, 1280×720, cidade de teste |
| Celular real (FPS/GPU/temperatura) | ABSENT |
| Código-fonte (análise estática) | FOUND |

### Performance Budgets
| Metric | Budget | Medido | Status |
|---|---|---|---|
| Frame time | não definido | lógica 3,4 ms parado; até 14,2 ms dirigindo (pico do "mundo") | NOT ASSESSED — no budget set |
| Memory | não definido | heap JS 64→75 MB (Médio) e 66→79 MB (Baixo) após 28 s dirigindo ~6 km | NOT ASSESSED — no budget set |
| Load time | não definido | 1,2–1,5 s até o JOGAR (cidade de teste, sem rede) | NOT ASSESSED — no budget set |
| Draw calls | não definido | Baixo 85 · Médio 122 | NOT ASSESSED — no budget set |
| Triângulos | não definido | Baixo 163 mil · Médio 298 mil | NOT ASSESSED — no budget set |

### Dados por sistema (ms/quadro, média móvel, dirigindo e carregando mapa)
| Sistema | Baixo | Médio |
|---|---|---|
| mundo (montar/descartar blocos, LOD) | **6,97** | **9,82** |
| desenho (envio p/ GPU, SwiftShader) | 3,15 | 3,04 |
| pedestres | 0,16 | 0,39 |
| trânsito | 0,12 | 0,29 |
| multidão | 0,15 | 0,30 |
| jogador / física / HUD / polícia | ≤ 0,17 cada | ≤ 0,16 cada |

### Hotspots Identified
| # | Location | Issue | Estimated Impact | Fix Effort |
|---|---|---|---|---|
| 1 | `src/map/WorldStreamer.js` `_build` → `buildWorld` + `buildFurniture` + trimesh Rapier | Bloco inteiro montado num quadro só: média de 7–10 ms, picos bem maiores = engasgo ao dirigir | Alto (travadinhas na troca de bloco) | M |
| 2 | `src/map/RoadGraph.js` (grafo só cresce) | Nós de blocos descartados nunca saem: 1.696→2.688 nós em 6 km; heap +11–13 MB | Médio (memória cresce em partidas longas) | M |
| 3 | `src/entities/RealHuman.js` | 21,5 mil triângulos por pessoa realista; maior parte dos 298 mil no Médio | Médio na GPU (celular) | L |
| 4 | `src/core/Game.js` `_frame`/`_ctx`, `systems/Collisions.js`, `NPCController.hitTest/bubbles` | Arrays/objetos/closures novos todo quadro (`slice`, `filter`, spread) → coleta de lixo | Baixo (micro-engasgos) | S |

### Optimization Recommendations (Priority Order)
1. **Montagem incremental dos blocos** — dividir `_build` em etapas (prédios / ruas / mobiliário / colisor) em quadros diferentes, ou mover a geração de geometria para um Web Worker.
   - Location: `src/map/WorldStreamer.js` (`_build`)
   - Expected gain: tirar ~7–10 ms dos quadros de troca de bloco
   - Risk: Med · Approach: fila de tarefas com orçamento de ~3 ms por quadro
2. **Podar o grafo** — remover nós/arestas de blocos descartados (registrar quais nós cada bloco adicionou).
   - Location: `src/map/RoadGraph.js`, `WorldStreamer._unload`
   - Expected gain: memória estável em partidas longas · Risk: Med (rotas de NPCs/missões apontando para nós removidos)
3. **Pessoa realista leve** — malha simplificada (~6 mil triângulos) para NPCs; detalhada só no André.
   - Expected gain: −60–70% dos triângulos no Médio · Risk: Med (qualidade visual)

### Quick Wins (< 1 hour each)
- Reaproveitar arrays por quadro (`npc.peds.slice`, `traffic.cars.filter` em `Collisions.resolveOnFoot`, `traffic.police()` chamado 3×/quadro).

### Deferred to Polish
O usuário não escolheu otimizar agora; registrados como problema conhecido: #1 montagem incremental, #2 poda do grafo, #3 modelo leve, #4 lixo por quadro.

### Requires Investigation
- **FPS, GPU e temperatura em celular real** — rodar o APK e ler F3/⚙ (NOT ASSESSED — NO DATA).
- **Mapa real de Jundiaí** (mais prédios que a cidade de teste) — servidores de mapa bloqueados neste ambiente.
- Sessão longa (>30 min) — `/soak-test`.

Verdict: **COMPLETE** — performance profile generated (saved to `production/polish/full-report-2026-11-21.md`).
