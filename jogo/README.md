# Jundiaí City (Godot 4)

Jogo 3D de mundo aberto com as ruas e prédios reais de Jundiaí (OpenStreetMap).
Você começa no **Jardim Tarumã** com o André e o carro dele.

## Como jogar
1. Baixe a Godot 4.3 ou mais nova: https://godotengine.org/download (é grátis, não precisa instalar).
2. Abra a Godot → **Importar** → escolha o arquivo `project.godot` desta pasta.
3. Aperte **F5** (Play). Precisa de internet na primeira vez em cada região.

## Gerar o .exe (compilado)
Na Godot: **Projeto → Exportar → Adicionar → Windows Desktop** → *Gerenciar modelos de exportação* (baixa uma vez) → **Exportar projeto**.

## Controles
WASD andar/dirigir · Mouse câmera · Shift correr · Espaço pular / freio de mão ·
E entrar/sair (carro e lugares) · R desvirar carro · F1 Jardim Tarumã · F2 Dom Olivio · Esc soltar o mouse

## Como funciona
- O mapa é baixado em blocos de ~400 m conforme você anda (OpenStreetMap / Overpass).
- Cada bloco fica salvo no computador (pasta `user://cache`); na próxima vez carrega sem internet.
- Lugares com nome (lojas, escolas, padarias...) têm um marcador amarelo: aperte **E** para entrar.
- Os lugares encontrados e visitados ficam salvos em `user://save.json`.
- Sem internet e sem cache, o jogo cria uma cidade de teste para você poder jogar.
- Pasta `user://` no Windows: `%APPDATA%\Godot\app_userdata\Jundiai City`.
