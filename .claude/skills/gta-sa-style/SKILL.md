---
name: gta-sa-style
description: Aplica estética gráfica estilo GTA San Andreas (PS2/RenderWare 2004), iluminação quente, shaders retrô e arquitetura de código otimizada para jogos 3D. Use ao criar shaders, materiais, iluminação, câmeras ou sistemas de gameplay.
---

# Diretrizes Visuais e Técnicas — Estilo GTA San Andreas (Era PS2)

Sempre que criar ou modificar gráficos, shaders, cenas ou lógica do jogo, siga rigorosamente estas regras:

## 1. Direção de Arte e Gráficos (RenderWare / PS2 Look)
- **Paleta e Atmosfera (Timecyc):** Use iluminação quente e saturada com tons âmbar, laranja e dourado no pôr do sol (estilo Los Santos). Aplique névoa de distância (*distance fog*) densa para esconder o horizonte e criar profundidade atmosférica.
- **Iluminação e Sombras:** Priorize *Vertex Lighting* (iluminação por vértice) e *Baked Lightmaps* em vez de sombras dinâmicas pesadas. Use sombras projetadas simples (*blob shadows* ou *planar shadows*) sob personagens e veículos.
- **Texturas e Materiais:** Utilize texturas de baixa/média resolução (256x256 ou 512x512) com filtragem bilinear suave, sem mapas PBR modernos (sem *normal maps* ou *roughness* complexos). Aplique reflexos especulares simples (*environment map* / *matcap* falso) apenas na lataria dos carros.
- **Modelagem Low-Poly:** Mantenha a geometria limpa e angular, com personagens entre 1.500 e 3.000 triângulos e veículos entre 3.000 e 6.000 triângulos.

## 2. Pós-Processamento (Shaders)
- Adicione um shader de tela cheia com leve *bloom* estourado nas luzes, aberração cromática sutil e filtro de cor quente (*color grading* sépia/âmbar).
- Inclua efeito opcional de *heat haze* (ondulação de calor) no horizonte em dias ensolarados.

## 3. Padrão de Código e Arquitetura
- **Separação de Responsabilidades:** Separe física/movimentação, máquina de estados (Idle, Walk, Run, Drive) e renderização em módulos independentes.
- **Performance (60 FPS cravados):** Use *Object Pooling* para pedestres, tráfego de veículos, projéteis e partículas. Aplique *LOD (Level of Detail)* e *Frustum Culling* agressivos.
- **Tipagem e Clareza:** Escreva código estritamente tipado, com funções curtas, nomes descritivos em inglês e comentários apenas onde a matemática de shader ou física exigir explicação.
