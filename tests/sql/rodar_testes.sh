#!/usr/bin/env bash
# =============================================================================
# tests/sql/rodar_testes.sh
# -----------------------------------------------------------------------------
# Roda os testes do banco num Postgres LIMPO (nunca no Supabase real).
# Usado pelo GitHub Actions (.github/workflows/testes.yml). Você não precisa
# rodar isto no Windows: o GitHub roda sozinho a cada envio (push).
#
# Variáveis: PGHOST, PGPORT, PGUSER, PGPASSWORD (padrão do psql).
# Banco usado: fin_testes (é apagado e recriado a cada execução).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=fin_testes
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

echo "==> Recriando banco de testes '$DB'"
dropdb --if-exists "$DB"
createdb "$DB"

echo "==> Simulando Supabase (auth, papéis)"
"${PSQL[@]}" -f tests/sql/00_stub_supabase.sql

echo "==> Aplicando sql/001_schema.sql"
"${PSQL[@]}" -f sql/001_schema.sql

echo "==> Criando usuários de teste e aplicando sql/002_bootstrap_familia.sql"
"${PSQL[@]}" -c "insert into auth.users (email) values ('renan@teste.com'), ('camilla@teste.com')"
sed -e 's/EMAIL_DO_RENAN@exemplo.com/renan@teste.com/' \
    -e 's/EMAIL_DA_CAMILLA@exemplo.com/camilla@teste.com/' \
    sql/002_bootstrap_familia.sql | "${PSQL[@]}" > /dev/null

echo "==> Verificação de segurança (sql/003_verificacao.sql)"
RESULTADO=$("${PSQL[@]}" -At -F ' | ' -f sql/003_verificacao.sql)
echo "$RESULTADO"
if echo "$RESULTADO" | grep -qE 'FALHA|PENDENTE'; then
  echo "!! Verificação encontrou problemas"; exit 1
fi

echo "==> Testes de RLS e regras de negócio"
"${PSQL[@]}" -f tests/sql/10_testes_schema.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
