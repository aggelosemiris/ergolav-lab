#!/usr/bin/env bash
# Τοπικός έλεγχος της migration και του rls.sql σε προσωρινό PostgreSQL (χωρίς Supabase, χωρίς δίκτυο).
# Θέλει PostgreSQL 15+ (initdb, pg_ctl, psql). Ο φάκελος της βάσης σβήνεται στο τέλος.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
dir="$(mktemp -d)"; port="${PG_PORT:-54329}"
trap '"$bin/pg_ctl" -D "$dir" stop -m fast >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$dir"
run "'$bin/initdb' -D '$dir' -A trust -U postgres >/dev/null"
run "'$bin/pg_ctl' -D '$dir' -o '-p $port -k $dir -c listen_addresses=' -l '$dir/log' start >/dev/null"
psql=("$bin/psql" -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${psql[@]}" -f "$here/local-stub.sql"
"${psql[@]}" -f "$here/../migrations/20261116000000_auth_profiles.sql"
"${psql[@]}" -f "$here/../migrations/20261116000000_auth_profiles.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261117000000_has_password.sql"
"${psql[@]}" -f "$here/../migrations/20261117000000_has_password.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261118000000_allaxe_bot.sql"
"${psql[@]}" -f "$here/../migrations/20261118000000_allaxe_bot.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261119000000_bot_metrics_strict.sql"
"${psql[@]}" -f "$here/../migrations/20261119000000_bot_metrics_strict.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261120000000_price_monitoring.sql"
"${psql[@]}" -f "$here/../migrations/20261120000000_price_monitoring.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261121000000_price_service_role_grants.sql"
"${psql[@]}" -f "$here/../migrations/20261121000000_price_service_role_grants.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261123000000_quotes.sql"
"${psql[@]}" -f "$here/../migrations/20261123000000_quotes.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261125000000_tech_prices.sql"
"${psql[@]}" -f "$here/../migrations/20261125000000_tech_prices.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../seed/tech-price-keys.sql" >/dev/null
"${psql[@]}" -f "$here/../seed/tech-price-keys.sql" >/dev/null   # ξανατρέξιμο
"${psql[@]}" -t -A -f "$here/rls.sql" | tail -1
"${psql[@]}" -t -A -f "$here/price-rls.sql" | tail -1
"${psql[@]}" -t -A -f "$here/quotes-rls.sql" | tail -1
"${psql[@]}" -t -A -f "$here/tech-prices-rls.sql" | tail -1
"${psql[@]}" -f "$here/../migrations/20261126000000_product_catalog_prices.sql"
"${psql[@]}" -f "$here/../migrations/20261126000000_product_catalog_prices.sql"   # ξανατρέξιμο
"${psql[@]}" -f "$here/../migrations/20261127000000_product_catalog_prices_report_read.sql"
"${psql[@]}" -f "$here/../migrations/20261127000000_product_catalog_prices_report_read.sql"   # ξανατρέξιμο
"${psql[@]}" -t -A -f "$here/product-catalog-prices-rls.sql" | tail -1
