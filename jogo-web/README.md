# Auto Theft Jundiaí — mundo aberto 3D (navegador e Android)

Jogo em 3ª pessoa estilo "mundo aberto urbano" com **ruas e prédios reais do OpenStreetMap**,
IA de NPCs **100% local** (zero tokens, nenhuma API de LLM) e 3 missões.

## Mapa de Jundiaí otimizado (skill `jundiai-openworld-optimizer`)
- **Editor time** — `npm run bake` (`tools/bake-jundiai.mjs`, roda no GitHub antes do APK, com cache): baixa a mancha
  urbana de Jundiaí do OpenStreetMap uma vez, classifica cada prédio pela zona (`landuse` industrial/residencial/comercial),
  corta etiquetas inúteis e grava blocos prontos em `public/map/jundiai/`. O jogo/APK lê esses arquivos: **zero download no jogo**.
  Fora da área pré-processada (ou rodando sem o bake), o jogo baixa como antes e guarda.
- **Runtime sem travar** — a geometria de cada bloco é calculada num **Web Worker** (`src/map/meshWorker.js`); a thread principal
  só monta as malhas e espalha mobiliário/colisão/rotas em quadros diferentes. Medido: “mundo” caiu de 7–10 ms para ~0,2 ms por quadro.
- **LOD dos prédios** — até 260 m fachada completa (janelas, lojas, portas); além disso parede simples (shader barato).
- **Identidade local** — galpões de zinco na zona industrial; telha de barro nas casas; **mosaico português** preto e branco nas
  calçadas do Centro; **fiação elétrica** entre postes; **Serra do Japi** no horizonte a oeste; sol `#FFF4E0` e sombra azulada `#87CEEB`.
- **Ainda não**: relevo real (DEM) — ruas e prédios continuam no plano; é a próxima etapa (mexe em física, carro, NPCs e trânsito).

## Jundiaí Vivo (planejamento em `design/game-brief.md`)
- **Relógio ao vivo**: 1 dia = 24 min; céu, luz, névoa, postes e janelas acompanham a hora (`src/live/Clock.js`).
- **Chuva** que vem e vai: céu cinza, gotas, poças, carro escorrega mais, som de chuva.
- **Entregas** (`src/live/Jobs.js`): o app oferece um pedido → **J** (📦 no celular) aceita → retire num comércio real →
  entregue no prazo. À noite paga +50%; atrasou recebe metade.
- **Casa do André** (`src/live/Home.js`), perto do Dom: E = dormir até as 7h (vida cheia + salva).
  Preso/desmaiado: acorda em casa, perde 20% do dinheiro e 3 horas.
- **Eventos na rua** (`src/live/CityEvents.js`): acidente (carros batidos, curiosos, ambulância) e blitz policial
  (passar a mais de 50 km/h ou procurado = estrela).
- **Ônibus** (`src/live/Bus.js`): linha circular pela Rua do Retiro; no ponto, E embarca (R$ 4,90), no próximo ponto E desce.
- **Festa da Uva**: a cada 5 dias de jogo (e todo dia em janeiro/fevereiro), barracas, uva (R$ 10, +20 de vida) e música.
- **Lanche no Dom Olívio** depois da 1ª missão: R$ 12, +30 de vida.

## Progresso e qualidade
- **Salvamento automático** (missão, dinheiro, posição) a cada 15 s e ao concluir missão; a abertura mostra
  **CONTINUAR** e **NOVO JOGO**. **Pausa** com P (ou Esc ao soltar o mouse) e botão ⏸ no celular.
- **Carros param no sinal vermelho** (e no amarelo, se ainda estiverem longe).
- **Teste de fumaça** `npm run smoke` (`tests/smoke.cjs`): abertura, mapa, andar, pedestres, compra no Dom, carro,
  missão, pausa e salvamento, sem erros de JavaScript. Roda no GitHub antes de gerar o APK.
- **Perfil de desempenho** com números medidos: `docs/perf-profile.md`.

## Celular (APK Android)
O APK é gerado pelo **GitHub Actions** (`.github/workflows/apk-android.yml`) a cada atualização do branch:
vá em **Releases** do repositório, baixe `AutoTheftJundiai.apk` no celular, abra e permita
“instalar de fontes desconhecidas”. No celular o jogo começa no gráfico **Baixo**, com **controles de toque**:
joystick à esquerda (empurre até o fim para correr), arraste à direita para girar a câmera,
botões **E** (ação), **⤒** (pular / freio de mão no carro), **📯** buzina, **⚙** gráficos e **🔊** som.
**Atualizar sem desinstalar (opcional):** sem configuração, cada APK sai com uma chave temporária, e para
instalar uma versão nova é preciso desinstalar a antiga. Para manter sempre a mesma chave, crie uma uma vez
(`keytool -genkeypair -keystore minha.keystore -alias autotheft -keyalg RSA -validity 10000`) e cadastre em
*Settings → Secrets and variables → Actions* do GitHub: `ANDROID_KEYSTORE_BASE64` (o arquivo em base64:
`base64 -w0 minha.keystore`), `ANDROID_KEYSTORE_PASSWORD` e `ANDROID_KEY_ALIAS` (`autotheft`). Nunca coloque a chave no repositório.
Projeto Android (Capacitor) em `jogo-web/android/`; para gerar localmente: `npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`.

## Rodar
```bash
cd jogo-web
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera a pasta dist/ (site estático)
```
O jogo é **somente Jundiaí**. Para começar em outro ponto da cidade: `?lat=-23.20&lon=-46.88`
(coordenadas fora de Jundiaí são ignoradas e o jogo abre no centro). Forçar horário: `?hora=22`.

## Começo: Dom Olívio, Rua do Retiro
O jogo começa na porta do **Dom Olívio**, na **Rua do Retiro**. O endereço é procurado na internet
(Nominatim; se falhar, Photon) **uma vez só** e fica salvo. Se o endereço cair no lugar errado, coloque as
coordenadas certas em `src/config.js` (`START.lat` e `START.lon`) — dá para pegar no Google Maps com o botão direito.
**Missão 1 — Compras no Dom:** entre no Dom Olívio (E na porta), compre pão, leite e café e leve até o seu carro.

## Só Jundiaí
O mapa só carrega dentro dos limites do município de Jundiaí.

## Mapa salvo (baixa uma vez só)
Cada pedaço de Jundiaí baixado do OpenStreetMap é salvo como arquivo na pasta **`jogo-web/osm-cache/`**
(e também no navegador). Da próxima vez o jogo abre aquele pedaço **sem internet e sem baixar de novo**,
mesmo trocando de navegador ou limpando os dados. Para compartilhar o mapa já baixado, copie essa pasta.
**Se o OpenStreetMap (Overpass) estiver fora do ar**, o jogo baixa do plano B: os mapas vetoriais da **OpenFreeMap**.

## Controles
WASD mover/dirigir · Mouse câmera (clique para travar) · Shift correr · Espaço pular / freio de mão ·
E (ou F) entrar/sair/roubar carro/interagir · H buzina · **G troca o nível de gráfico** · M som · **P pausa** · F3 medidor de desempenho

## Visual estilo GTA San Andreas (skill `gta-sa-style`)
- **Timecyc:** paleta de cores por hora do dia (`src/render/Timecyc.js`) — pôr do sol âmbar/laranja, noite azulada.
- **Névoa densa** que esconde o horizonte e o fim dos blocos do mapa; céu em degradê com halo do sol (`SkyDome.js`).
- **Iluminação simples (Lambert), sem PBR**; só a lataria dos carros tem reflexo do céu (environment map).
- **Blob shadows** sob André, pedestres e carros — 1 chamada de desenho (`BlobShadows.js`). Sombra dinâmica só dos prédios no nível Alto.
- **Pós-processamento** (`PostFX.js`): bloom nas luzes (Médio/Alto), filtro quente sépia/âmbar, aberração cromática sutil,
  vinheta e ondulação de calor no horizonte das 10h às 16h.

## Cidade (skill `aaa-openworld-gta-overhaul`, estilo híbrido)
- **Mobiliário urbano** (`src/map/StreetFurniture.js`): postes de luz a cada ~30 m (acendem à noite, com luz no chão),
  **semáforos** nos cruzamentos das ruas maiores (ciclo verde 9 s · amarelo 2 s · vermelho 11 s, ruas cruzadas alternam),
  **faixas de pedestre** em todo cruzamento, lixeiras laranja e hidrantes vermelhos. ~5 chamadas de desenho por bloco;
  some nos blocos distantes (LOD).
- **Meio-fio** de 14 cm na borda das pistas e **poças** no asfalto que refletem o céu.
- **Fachadas por zona**: casas com porta e janela no térreo; comércio com vitrine e toldo listrado (acesa à noite);
  indústria com portão de enrolar; platibanda escura no topo.
- Oclusão de ambiente (GTAO) existe no código mas está desligada: escureceu demais os prédios nos testes.

## Pessoas realistas e som
- **André** e os **pedestres homens mais próximos** usam um modelo escaneado de pessoa real com animação de caminhada:
  “Nathan Animated 003 - Walking 3D Man” por [Renderpeople](https://sketchfab.com/renderpeople)
  ([Sketchfab](https://sketchfab.com/3d-models/nathan-animated-003-walking-3d-man-143a2b1ea5eb4385ae90a73657aca3bc)),
  licença [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) — arquivo e licença em `public/models/nathan/`.
  Um shader troca a cor da camiseta e da calça de cada clone (a pele fica igual). Os demais (mais longe,
  mulheres e uniformizados) usam o boneco leve. Quantos realistas: Baixo 4 · Médio 8 · Alto 14.
- **Som** gerado na hora (Web Audio, sem arquivos): motor com troca de marcha, pneu cantando, buzina, sirene,
  passos, batidas, cidade ao fundo, passarinhos de dia, caixa registradora e música de missão. **M** liga/desliga.

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
