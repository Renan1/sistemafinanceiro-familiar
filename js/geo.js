/**
 * =============================================================================
 * js/geo.js — Localização do gasto (RF-14)
 * -----------------------------------------------------------------------------
 * A captura COMEÇA quando a tela de novo gasto abre (não ao salvar), para a
 * posição já estar pronta quando você tocar em Salvar.
 *
 *   * timeout de 5 s e maximumAge de 60 s (aceita posição de até 1 min atrás);
 *   * se você negar a permissão, der erro ou demorar: segue SEM localização;
 *   * nunca bloqueia nem atrasa o registro — Salvar usa o que tiver no momento.
 *
 * Uso:
 *   const captura = iniciarCaptura();   // ao abrir a tela
 *   ...
 *   const pos = captura.atual();        // ao salvar: {latitude, longitude, precisao} ou null
 * =============================================================================
 */
import { log } from './log.js';

const OPCOES = { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 };

/**
 * Inicia uma captura de posição.
 * @param {(estado:string, pos?:object)=>void} [aoMudar]  avisa a tela:
 *        'buscando' | 'ok' | 'negado' | 'indisponivel'
 */
export function iniciarCaptura(aoMudar = () => {}) {
  let posicao = null;

  if (!('geolocation' in navigator)) {
    aoMudar('indisponivel');
    return { atual: () => null };
  }

  aoMudar('buscando');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      posicao = {
        latitude: Number(p.coords.latitude.toFixed(6)),
        longitude: Number(p.coords.longitude.toFixed(6)),
        precisao: Math.round(p.coords.accuracy * 10) / 10,
      };
      aoMudar('ok', posicao);
    },
    (erro) => {
      // 1 = permissão negada, 2 = sem sinal de GPS, 3 = demorou demais
      const estado = erro.code === 1 ? 'negado' : 'indisponivel';
      log.aviso('geo', 'Sem localização — o gasto será salvo sem ela', { codigo: erro.code });
      aoMudar(estado);
    },
    OPCOES,
  );

  return { atual: () => posicao };
}
