---
name: AAA_OpenWorld_GTA_Overhaul
description: Transforma jogos de mundo aberto baseados em mapas reais (OpenStreetMap/OpenFreeMap) em experiências visuais e mecânicas de nível AAA (estilo GTA), otimizando gráficos PBR, iluminação global, IA de multidões e física de veículos/personagens.
---

> **Decisão do projeto (Jundiaí City):** estilo **híbrido**. Mantém a direção de arte quente da skill
> `gta-sa-style` (timecyc, névoa, blob shadows) e aplica desta skill o que não derruba o FPS.
> Efeitos pesados (SSAO/GTAO, PBR completo, TAA, motion blur) ficam **só no nível de gráfico Alto**.

# Diretrizes de Execução da Skill

Ao aplicar esta skill no projeto do jogo, execute as melhorias seguindo estritamente os quatro módulos abaixo, priorizando desempenho (60+ FPS) e fotorrealismo.

## Módulo 1: Geração Procedural via OpenFreeMap / OSM
Converta dados vetoriais brutos de mapas em malhas 3D detalhadas e texturizadas:
- **Malha Viária:** Transforme splines de ruas (`highway=*`) em vias com asfalto texturizado, faixas de sinalização, meios-fios em relevo e calçadas conectadas automaticamente nos cruzamentos.
- **Edificações Procedurais:** Extrude polígonos de prédios (`building=*`) usando altura real (`building:levels`) e aplique fachadas modulares (janelas com reflexo, portas no térreo, detalhes no topo) baseadas na zona (comercial, residencial, industrial).
- **Mobiliário Urbano:** Instancie automaticamente postes de luz, semáforos nos cruzamentos, hidrantes, lixeiras e árvores ao longo das calçadas usando instanciamento em lote (GPU Instancing).

## Módulo 2: Pipeline Gráfico Fotorrealista (Nível AAA)
Substitua materiais básicos e iluminação plana por renderização moderna:
- **Iluminação e Atmosfera:** Configure ciclo dinâmico de dia e noite com iluminação global em tempo real (Lumen/GI), céu físico atmosférico, névoa volumétrica distante e oclusão de ambiente (SSAO/GTAO).
- **Materiais PBR:** Aplique shaders Physically Based Rendering em todas as superfícies com mapas de Albedo, Normal, Roughness e Ambient Occlusion. Adicione variação de umidade/poças no asfalto para reflexos dinâmicos.
- **Pós-Processamento Cinematográfico:** Ative ACES Filmic Tone Mapping, Bloom sutil, Motion Blur por objeto e Anti-Aliasing temporal (TAA/TSR) para eliminar serrilhados.

## Módulo 3: Ecossistema Vivo de NPCs e Trânsito
Implemente inteligência artificial reativa e otimizada para multidões:
- **Sistema de Pedestres:** Crie pools de NPCs variados que caminham pelas calçadas, atravessam nas faixas respeitando semáforos, interagem com o ambiente e fogem em pânico ao detectar tiros, explosões ou veículos em alta velocidade.
- **IA de Trânsito:** Configure veículos autônomos que seguem as vias do mapa, respeitam distância de segurança, param no sinal vermelho, desviam de obstáculos e reagem a colisões.
- **Animação Fluida:** Utilize Blend Spaces e Inverse Kinematics (IK) nos pés para que NPCs e o jogador pisem corretamente em rampas, escadas e meios-fios sem deslizar.

## Módulo 4: Jogabilidade, Câmera e Física Refinadas
Melhore a resposta dos controles e a sensação de peso do mundo:
- **Física de Veículos:** Configure suspensão independente nas quatro rodas, curvas de torque realistas, derrapagem controlada (drift) e deformação/fumaça em caso de dano.
- **Movimentação do Jogador:** Adicione aceleração e desaceleração suaves, sistema de cobertura (cover), escalada de obstáculos baixos e mira responsiva com recuo (recoil) realista nas armas.
- **Câmera Dinâmica:** Implemente câmera em terceira pessoa com amortecimento suave (spring arm lag), ajuste dinâmico de FOV conforme a velocidade e vibração sutil em impactos.
- **Otimização Obrigatória:** Configure LODs (Level of Detail) agressivos, Frustum/Occlusion Culling e streaming de blocos do mapa ao redor do jogador para evitar quedas de FPS.
