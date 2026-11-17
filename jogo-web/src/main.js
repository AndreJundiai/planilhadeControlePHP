import './ui/hud.css';
import { Game } from './core/Game.js';

new Game().start().catch((e) => {
  console.error(e);
  document.getElementById('loading').textContent = 'Erro ao iniciar: ' + e.message;
});
