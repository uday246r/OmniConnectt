#!/usr/bin/env bash
# First-install configuration: writes deploy/.env and deploy/env/*.env with freshly generated secrets.
#
#   deploy/scripts/init-env.sh                                  # asks the questions it needs
#   deploy/scripts/init-env.sh --domain app.example.com --email ops@example.com --mode windows --yes
#
# Every secret is generated here, on the server, and never leaves it: the RS256 signing key pair, one
# internal key per service, the catalogue key, the release agent's key and the database password. Each
# value that two files must share (a service's key in auth.env and in its own file, the catalogue key in
# lead.env and products.env, the JWT public key everywhere) is written to both from one variable, so
# they cannot disagree.
#
# It refuses to overwrite existing files: regenerating secrets on a running installation would sign
# everyone out and break the database login. Pass --force only on a machine with nothing to keep.
#
# Options:
#   --domain <name>        public host name, e.g. omniconnect.company.com (required)
#   --email <address>      contact for Let's Encrypt expiry notices
#   --mode windows|linux   windows: Caddy on Windows terminates HTTPS in front of nginx (default)
#                          linux:   nginx is the public edge on port 80 (TLS done in front of it)
#   --db local|external    local: PostgreSQL on this machine (default); external: you fill in the
#                          connection strings in env/*.env afterwards
#   --crm-base-url <url> --crm-client-id <id> --crm-client-secret <secret>
#                          Customer 360's external CRM (optional; can be added to env/customer360.env later)
#   --yes                  do not ask; use the options given
#   --force                overwrite existing files (destroys the current secrets)
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

die() { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }
ok()  { printf '\033[1;32m✔\033[0m %s\n' "$*"; }

DOMAIN="" EMAIL="" MODE="windows" DB="local" CRM_URL="" CRM_ID="" CRM_SECRET="" YES=false FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --crm-base-url) CRM_URL="$2"; shift 2 ;;
    --crm-client-id) CRM_ID="$2"; shift 2 ;;
    --crm-client-secret) CRM_SECRET="$2"; shift 2 ;;
    --yes) YES=true; shift ;;
    --force) FORCE=true; shift ;;
    *) die "Unknown option $1 (see the header of this script)." ;;
  esac
done

command -v openssl >/dev/null || die "openssl is required (sudo apt-get install -y openssl)."

ask() {   # ask <variable> <question> [secret]
  local __var="$1" __q="$2" __secret="${3:-}" __answer
  if [[ "$YES" == true ]]; then return; fi
  if [[ -n "$__secret" ]]; then read -r -s -p "$__q: " __answer; echo; else read -r -p "$__q: " __answer; fi
  [[ -n "$__answer" ]] && printf -v "$__var" '%s' "$__answer"
  return 0
}

[[ -n "$DOMAIN" ]] || ask DOMAIN "Public domain name (e.g. omniconnect.company.com)"
[[ -n "$EMAIL" ]] || ask EMAIL "Email for certificate notices (e.g. it-team@company.com)"
if [[ "$YES" != true && -z "$CRM_URL" ]]; then
  echo "Customer 360 connects to your external CRM. Leave these empty to add them later in env/customer360.env."
  ask CRM_URL "  CRM base URL"
  ask CRM_ID "  CRM client id"
  ask CRM_SECRET "  CRM client secret (hidden)" secret
fi

[[ -n "$DOMAIN" ]] || die "--domain is required."
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "'$DOMAIN' does not look like a host name."
[[ "$MODE" == windows || "$MODE" == linux ]] || die "--mode must be windows or linux."
[[ "$DB" == local || "$DB" == external ]] || die "--db must be local or external."

TARGETS=(.env env/auth.env env/lead.env env/customer360.env env/products.env)
if [[ "$FORCE" != true ]]; then
  for f in "${TARGETS[@]}"; do
    [[ -e "$f" ]] && die "deploy/$f already exists. This installation is already configured — re-running would replace its secrets. (--force overwrites, on a machine with nothing to keep.)"
  done
fi

# ── Secrets ─────────────────────────────────────────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP/priv.pem" 2>/dev/null
openssl pkey -in "$TMP/priv.pem" -pubout -out "$TMP/pub.pem" 2>/dev/null
# Single line with literal \n, the form every service reads (see SETUP.md).
one_line() { awk 'BEGIN{ORS="\\n"} {print}' "$1" | sed 's/\\n$//'; }
JWT_PRIVATE="$(one_line "$TMP/priv.pem")"
JWT_PUBLIC="$(one_line "$TMP/pub.pem")"
key() { openssl rand -hex 32; }
LEAD_KEY="$(key)"; C360_KEY="$(key)"; PRODUCTS_KEY="$(key)"; CATALOG_KEY="$(key)"; AGENT_KEY="$(key)"
# Hex only: no character that could end or split a connection string.
DB_PASSWORD="$(openssl rand -hex 24)"

if [[ "$DB" == local ]]; then
  conn() { echo "Host=db;Port=5432;Database=$1;Username=postgres;Password=$DB_PASSWORD"; }
else
  conn() { echo "Host=<db-host>;Port=5432;Database=$1;Username=<user>;Password=<password>;SSL Mode=Require"; }
fi

if [[ "$MODE" == windows ]]; then
  EDGE_PROXY=local-proxy; PUBLIC_BIND=127.0.0.1; PUBLIC_PORT=8080
else
  EDGE_PROXY=none; PUBLIC_BIND=0.0.0.0; PUBLIC_PORT=80
fi

JWT_LINES="Jwt__SigningKeyPublic=$JWT_PUBLIC
Jwt__Issuer=omniconnect-auth-service
Jwt__Audience=omniconnect-host"

mkdir -p env
umask 077

cat > .env <<EOF
# Generated by scripts/init-env.sh on $(date -u +%Y-%m-%dT%H:%MZ). Holds secrets — never commit or share.
DOMAIN=$DOMAIN
LETSENCRYPT_EMAIL=$EMAIL
RELEASE_ROOT=/srv/omniconnect
PUBLIC_BIND=$PUBLIC_BIND
PUBLIC_PORT=$PUBLIC_PORT
EDGE_PROXY=$EDGE_PROXY
PROXY_SUBNET=172.30.0.0/24
# Container engine: podman (rootful; the scripts re-run themselves with sudo) or docker. Unset = podman if installed.
CONTAINER_ENGINE=podman
IMAGE_REGISTRY=localhost/omniconnect
AUTH_TAG=local
LEAD_TAG=local
C360_TAG=local
PRODUCTS_TAG=local
RELEASE_AGENT_KEY=$AGENT_KEY
COMPOSE_PROFILES=$([[ "$DB" == local ]] && echo localdb)
LOCAL_DB_PASSWORD=$([[ "$DB" == local ]] && echo "$DB_PASSWORD")
EOF

cat > env/auth.env <<EOF
ConnectionStrings__AuthDb=$(conn auth_service)
Jwt__SigningKeyPrivate=$JWT_PRIVATE
$JWT_LINES
Auth__SameSite=Lax
Internal__Services__LeadService__ApiKey=$LEAD_KEY
Internal__Services__Customer360Service__ApiKey=$C360_KEY
Internal__Services__ProductsService__ApiKey=$PRODUCTS_KEY
Internal__Services__ReleaseAgent__ApiKey=$AGENT_KEY
Google__ClientId=
Google__AllowedDomains=
Smtp__Host=
Smtp__Port=587
Smtp__Username=
Smtp__Password=
Smtp__FromAddress=
Smtp__FromName=OmniConnect
Smtp__AppBaseUrl=https://$DOMAIN
EOF

cat > env/lead.env <<EOF
ConnectionStrings__LeadDb=$(conn lead_service)
$JWT_LINES
AuthService__InternalApiKey=$LEAD_KEY
Internal__ApiKey=$LEAD_KEY
ProductsService__InternalApiKey=$CATALOG_KEY
Self__AppKey=lead
EOF

cat > env/customer360.env <<EOF
ConnectionStrings__Customer360Db=$(conn customer360_service)
CrmApi__BaseUrl=$CRM_URL
CrmApi__ClientId=$CRM_ID
CrmApi__ClientSecret=$CRM_SECRET
$JWT_LINES
AuthService__InternalApiKey=$C360_KEY
Internal__ApiKey=$C360_KEY
EOF

cat > env/products.env <<EOF
ConnectionStrings__DefaultConnection=$(conn products_service)
$JWT_LINES
AuthService__ServiceName=ProductsService
AuthService__InternalApiKey=$PRODUCTS_KEY
Internal__ApiKey=$PRODUCTS_KEY
Internal__CatalogApiKey=$CATALOG_KEY
Self__AppKey=products
Self__DisplayName=Products & Marketplace
EOF

ok "Wrote deploy/.env and deploy/env/{auth,lead,customer360,products}.env (readable by you only)."
echo "   Domain:   https://$DOMAIN"
echo "   Mode:     $MODE  (edge: $EDGE_PROXY, nginx on $PUBLIC_BIND:$PUBLIC_PORT)"
echo "   Database: $([[ "$DB" == local ]] && echo 'PostgreSQL on this machine (COMPOSE_PROFILES=localdb)' || echo 'external — fill in the connection strings in env/*.env')"
[[ -z "$CRM_URL" ]] && echo "   Customer 360 CRM: not set — add CrmApi__* to env/customer360.env when you have them."
echo "   Optional later: SMTP (password reset / invitation emails) and Google sign-in in env/auth.env."
echo "   Keep a copy of deploy/.env and deploy/env/ somewhere safe (e.g. the company password vault):"
echo "   without them, backups of the databases cannot be used by a new installation."
