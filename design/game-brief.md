# Game Brief: Auto Theft Jundiaí — Jundiaí Vivo

## In your words
- "Eu quero criar um Jogo estilo GTA mas nao seja GTA Seja 3D. E que pega os Dados De Jundiai E pega da base do opeb strets maps."
- "quero só um personagem que vai se chamad André e ele vai ter um carro e andar pro Jundiai"
- "Na verdade eu quero deixar Apenas Jundiai ... Mas o Jogo tem que Comecar no Dom Olivio na Ruao do Retiro na Missao comprar no DOM"
- "o mapa está todo zuado no sentido o nPC nem anda mais e nem som tem as pessoas parece do minecraft"
- Escolheu no /brainstorm: **Jundiaí Vivo** — "Uma cidade sandbox: dia e noite passando, chuva, festa da uva, ponto de ônibus, emprego, casa, dinheiro e eventos aleatórios na rua. Sem fim, só viver a cidade."

**Pitch:** Viva o dia a dia do André nas ruas reais de Jundiaí — trabalhe, dirija, fuja da polícia e veja a cidade acordar, chover e anoitecer. *(guessed)*

**Genre:** mundo aberto sandbox em 3ª pessoa (cidade viva)

**Controls:** PC: WASD, mouse, E, Espaço, H, P · Celular: joystick, arrastar para a câmera, botões E/⤒/📯/⏸

**Question:** Viver um dia inteiro em Jundiaí (trabalhar, voltar para casa, ver a noite chegar) é divertido por 20 minutos sem missão principal? *(guessed)*

**Hooks:** As ruas e lojas **reais** de Jundiaí (Rua do Retiro, Dom Olívio, Serra do Japi) e uma cidade que muda sozinha com a hora e o clima. *(guessed)*

**Intent:** no goal to reach — sem fim, só viver a cidade *(you said)*

## Look and references
- Look: híbrido San Andreas — paleta quente por hora do dia, névoa, sombras simples — com cidade detalhada (postes, semáforos, faixas, vitrines acesas à noite).
- References: estilo GTA San Andreas sem copiar *(you said)*; open-theft-auto (variedade e pessoas realistas).
- View: 3D · Camera: 3ª pessoa atrás do André/carro, girando com mouse ou dedo.

## First minute
7h na Rua do Retiro; a mãe liga: compras no Dom Olívio. André compra, leva ao carro e o relógio no canto mostra o tempo passando. O celular toca: o primeiro trabalho de entrega. *(guessed)*

## Challenge
A partir do 3º minuto, entregas com prazo: atrasar reduz o pagamento, correr demais chama a polícia, ser preso ou desmaiar custa dinheiro e manda André para casa. À noite as entregas pagam mais, mas há mais polícia. *(guessed)*

## Core loop
- Aceitar um trabalho pelo celular → dirigir pela cidade real → entregar no prazo → receber dinheiro
- Gastar (comida no Dom, gasolina, carro melhor) → dormir em casa → novo dia diferente (clima, eventos)

## Goal & fail state
- Uma sessão está completa quando André termina o dia em casa com mais dinheiro do que começou. *(guessed)*
- Falha: preso/desmaiado perde parte do dinheiro e o resto do dia; não há "game over". *(guessed)*

## Features
- [ ] Relógio do dia passando ao vivo (1 dia = 24 min): céu, luz, postes e janelas mudam sozinhos
- [ ] Emprego de entregas: pedido no celular, rota, prazo e pagamento
- [ ] Casa do André: dormir pula para a manhã e salva o jogo
- [ ] Chuva: céu escuro, gotas, asfalto molhado, carro escorrega
- [ ] Eventos aleatórios na rua (acidente, ambulância, blitz) *(guessed)*
- [ ] Ônibus com pontos de parada
- [ ] Festa da Uva (evento de calendário com barracas)

## Your systems
- dia e noite passando · in the slice
- emprego · in the slice
- casa · thin stand-in
- dinheiro · in the slice
- chuva · thin stand-in
- eventos aleatórios na rua · thin stand-in
- ponto de ônibus · later
- festa da uva · later

## Keep
-

## Avoid
- ser cópia do GTA ("mas nao seja GTA") *(you said)*
- outras cidades — "Apenas Jundiai" *(you said)*
- pessoas com cara de Minecraft; lentidão; NPC parado; mapa quebrado *(you said)*

## Out of scope
- multiplayer
- armas e tiroteio *(guessed)*
- outras cidades além de Jundiaí

## Build order
1. Relógio do dia ao vivo (base para clima, emprego e eventos) — objetivo: ver o dia virar noite jogando.
2. Emprego de entregas com prazo e pagamento — objetivo: entregar no prazo; falha: atrasar ou ser preso.
3. Casa e dormir, com salvamento.
4. Chuva.
5. Eventos aleatórios.
6. Ônibus.
7. Festa da Uva.

---
**Kill condition:** se após o relógio e as entregas um dia inteiro ainda parecer vazio ou chato, voltar para missões com história. *(guessed)*

**Who it's for / what they feel:** quem é de Jundiaí e quer reconhecer a própria rua — "essa é a minha cidade". *(guessed)*

**Games you love / don't:** gosta do GTA (estilo), San Andreas (clima) e open-theft-auto *(inferred (strong))*
