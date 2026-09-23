/**
 * =============================================================================
 * js/config.exemplo.js — MODELO da configuração do app
 * -----------------------------------------------------------------------------
 * PRODUÇÃO (site publicado): você não mexe em nada. O GitHub Actions gera o
 * js/config.js a partir dos Secrets SUPABASE_URL e SUPABASE_ANON_KEY (D-07).
 *
 * NO SEU PC (para testar local):
 *   1. Copie este arquivo para js/config.js:
 *        Copy-Item js\config.exemplo.js js\config.js
 *   2. Preencha com a Project URL e a publishable/anon key do Supabase.
 *   3. js/config.js está no .gitignore: ele NUNCA vai para o GitHub.
 *
 * NUNCA coloque aqui a chave "secret" / "service_role".
 * =============================================================================
 */
export const CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'COLE-AQUI-A-PUBLISHABLE-OU-ANON-KEY',
  build: 'local',
};
