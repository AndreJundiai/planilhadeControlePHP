# Jundiaí City — mundo aberto 3D no navegador

Jogo em 3ª pessoa estilo "mundo aberto urbano" com **ruas e prédios reais do OpenStreetMap**,
IA de NPCs **100% local** (zero tokens, nenhuma API de LLM) e 3 missões.

## Rodar
```bash
cd jogo-web
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera a pasta dist/ (site estático)
```
O jogo é **somente Jundiaí**. Para começar em outro ponto da cidade: `?lat=-23.20&lon=-46.88`
(coordenadas fora de Jundiaí são ignoradas e o jogo abre no centro). Forçar horário: `?hora=22`.

## Mapa salvo (baixa uma vez só)
Cada pedaço de Jundiaí baixado do OpenStreetMap é salvo como arquivo na pasta **`jogo-web/osm-cache/`**
(e também no navegador). Da próxima vez o jogo abre aquele pedaço **sem internet e sem baixar de novo**,
mesmo trocando de navegador ou limpando os dados. Para compartilhar o mapa já baixado, copie essa pasta.

## Controles
WASD mover/dirigir · Mouse câmera (clique para travar) · Shift correr · Espaço pular / freio de mão ·
E (ou F) entrar/sair/roubar carro/interagir · H buzina · **G troca o nível de gráfico**

## Visual estilo GTA San Andreas (skill `gta-sa-style`)
- **Timecyc:** paleta de cores por hora do dia (`src/render/Timecyc.js`) — pôr do sol âmbar/laranja, noite azulada.
- **Névoa densa** que esconde o horizonte e o fim dos blocos do mapa; céu em degradê com halo do sol (`SkyDome.js`).
- **Iluminação simples (Lambert), sem PBR**; só a lataria dos carros tem reflexo do céu (environment map).
- **Blob shadows** sob André, pedestres e carros — 1 chamada de desenho (`BlobShadows.js`). Sombra dinâmica só dos prédios no nível Alto.
- **Pós-processamento** (`PostFX.js`): bloom nas luzes (Médio/Alto), filtro quente sépia/âmbar, aberração cromática sutil,
  vinheta e ondulação de calor no horizonte das 10h às 16h.

## Modelos
- **Pessoas** (`src/entities/Human.js`, ~1.600 triângulos): esqueleto com quadril, coluna, pescoço, ombros, cotovelos,
  joelhos e tornozelos; rosto com olhos, sobrancelhas, nariz, boca e orelhas. Caminhada e corrida dobram joelhos e cotovelos.
  NPCs variam altura, porte, cabelo (curto, comprido, careca, moicano), manga curta/comprida, bermuda e tênis.
  **16 tipos de pedestre**: casual, mulheres (calça, saia, vestido, bolsa), executivo, segurança, policial militar, bombeiro,
  médico(a), pedreiro, gari, entregador com caixa térmica, idoso (anda mais devagar), turista, caipira e jovem.
- **Multidão em lote** (`src/render/CrowdRenderer.js`): todos os pedestres em ~10 chamadas de desenho (uma por parte do corpo).
- **Carros** (`src/player/Vehicle.js`, ~4.400 triângulos): perfil extrudado com bordas arredondadas (capô, para-brisa inclinado,
  teto, porta-malas, para-lamas), rodas com aro e raios, grade, placas Mercosul, retrovisores, maçanetas e escapamento.
  Tipos: sedã, hatch e SUV; viatura com faixa azul e giroflex.

## Desempenho
- **Níveis de gráfico** (Baixo / Médio / Alto): resolução, sombras, distância de visão, quantidade de pedestres e carros.
  O jogo começa no Médio e **baixa sozinho** se ficar abaixo de 30 FPS. A tecla G escolhe manualmente (fica salvo).
- **Mapa em blocos** (~420 m): carrega 3x3 blocos ao redor e descarta os distantes — a cidade não acaba e a memória não cresce.
- Carros e pessoas com poucas malhas e materiais compartilhados (poucas chamadas de desenho).

## Stack
| Parte | Tecnologia |
|---|---|
| Render 3D | Three.js (prédios extrudados, janelas por shader, sombras, ciclo dia/noite pelo relógio) |
| Dados do mapa | OpenStreetMap via Overpass API, salvo no Cache Storage do navegador |
| Minimapa | MapLibre GL JS + tiles vetoriais OpenFreeMap (canvas com as ruas do OSM se os tiles falharem) |
| Física | Rapier3D (WASM): paredes dos prédios como trimesh + character controller para André e para o carro |
| Build | Vite, JavaScript ES modules |

> O MapLibre fica no minimapa e o 3D é Three.js puro alimentado pelos dados do OSM: no modo
> CustomLayer a câmera pertence ao mapa, o que atrapalha a câmera em 3ª pessoa e a física.

## Arquitetura de pastas
```
jogo-web/
├── index.html              # canvas + HUD
├── vite.config.js
└── src/
    ├── main.js             # ponto de entrada
    ├── config.js           # spawn, raio do mapa, quantidade de NPCs/carros, servidores
    ├── core/
    │   ├── Game.js         # loop principal: orquestra mapa, física, IA, missões e HUD
    │   ├── Input.js        # teclado + mouse (pointer lock)
    │   └── math.js
    ├── map/
    │   ├── OSMLoader.js    # Overpass + cache + cidade de teste offline
    │   ├── Projection.js   # lon/lat <-> metros
    │   ├── WorldBuilder.js # extrusão de prédios (height/building:levels), ruas, calçadas, árvores
    │   └── RoadGraph.js    # grafo dos nós reais do OSM, A*, Dijkstra, nome da rua
    ├── physics/Physics.js  # Rapier3D
    ├── entities/Human.js   # boneco low-poly (André e NPCs)
    ├── player/
    │   ├── Player.js       # André a pé / dirigindo
    │   ├── Vehicle.js      # carro + física arcade com derrapagem
    │   └── CameraRig.js    # câmera orbital com colisão
    ├── ai/
    │   ├── NPCController.js     # pedestres: FSM + Utility AI + A* + pooling + falas
    │   ├── TrafficController.js # trânsito, polícia (perseguição por A*), carro alvo
    │   └── dialogs.json         # árvore de decisão das falas
    ├── systems/
    │   ├── WantedSystem.js # estrelas de procurado (1 a 3)
    │   └── MissionManager.js # as 3 missões
    └── ui/
        ├── HUD.js          # objetivo, timer, vida, estrelas, velocímetro, telefone, balões, minimapa
        └── hud.css
```

## IA dos NPCs (sem LLM)
- **Estados:** ROTINA (passeia por rotas A* nas calçadas reais), CURIOSO (para e comenta), MEDO (se afasta),
  FUGA (corre para longe da ameaça), CAIDO (atropelado), PARADO (NPC de missão).
- **Utility AI:** a cada 0,25 s cada NPC pontua medo (carro rápido perto, batidas, buzina, sirene, atropelos),
  curiosidade (jogador parado perto) e rotina; vence a maior nota, com histerese.
- **Falas:** `dialogs.json` é uma árvore `{test, yes, no}` avaliada com o contexto (hora, noite, estrelas, se está de carro).
- **Pooling:** 40 pedestres e 18 carros fixos; quem fica longe renasce num nó fora da visão da câmera.

## Procurado
Atropelar (+1), colisão grave (+1), bater em viatura (+1), roubar carro perto da polícia (+1). Máximo 3.
Cada estrela traz uma viatura que replaneja A* até você. Fique longe delas para as estrelas caírem;
parado ao lado de uma viatura por 3 s = preso.

## Missões
1. **O Recado na Esquina** — ligação no HUD; ir a pé até um ponto a ~300 m (medidos pelas calçadas reais) em 2:30.
2. **Entrega Sob Pressão** — pegue a maleta, o carro azul (ou roube um) e dirija ~1,5 km pelas ruas; no meio do caminho
   a polícia vê a maleta (1★): despiste antes de entregar.
3. **Interceptação Estratégica** — um carro amarelo roda num circuito fixo; feche a frente dele com seu carro
   (devagar, por 2,5 s) sem destruí-lo, desça e pegue o item.
