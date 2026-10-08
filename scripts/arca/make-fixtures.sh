#!/usr/bin/env bash
# Fixtures de la cripto de ARCA (WP1, diseño §2.8). Se corre A MANO, una vez, y
# se commitean los archivos que deja en tests/fixtures/arca/. Los tests NO corren
# openssl ni usan la red: leen estos archivos.
#
#   scripts/arca/make-fixtures.sh [carpeta]          (por defecto: tests/fixtures/arca)
#   OPENSSL=/opt/homebrew/bin/openssl scripts/arca/make-fixtures.sh
#
# Necesita OpenSSL 3.4 o más nuevo (por -not_before/-not_after; el openssl que
# trae macOS es LibreSSL y no sirve) y las dependencias del repo ya instaladas
# (usa `npx tsx`, que está en devDependencies).
#
# Todo es sintético: CUIT con dígito verificador válido que no son de nadie, una
# AC de prueba propia y fechas fijas. Los valores son los de
# tests/fixtures/arca/crypto-constants.ts: si se cambia uno, cambiarlo en los dos
# lados. Volver a correrlo genera claves nuevas y regenera TODOS los archivos;
# los tests siguen andando porque comparan relaciones y datos fijos, no los bytes
# de una clave en particular.
#
# Solo escribe los archivos de abajo: no toca tests/fixtures/arca/xml/ (WP2).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/tests/fixtures/arca}"
OPENSSL="${OPENSSL:-openssl}"

# --- Datos fijos (iguales a crypto-constants.ts) ------------------------------
# Persona de WSASS 20-12345678-6 · SAS 30-71234567-1
PERSONA_SUBJ="/C=AR/O=Bar de Prueba SAS/CN=plataformatest/serialNumber=CUIT 20123456786"
CA_SUBJ="/C=AR/O=AC de Prueba/CN=AC de Prueba Computadores"
ISSUED_SUBJ="/serialNumber=CUIT 30712345671/CN=hubplataforma" # como lo reescribe ARCA
FIXED_NOW_EPOCH=1791460800                                    # 2026-10-08T12:00:00Z
# buildTra('wsfe', FIXED_NOW) tiene que dar exactamente esto (lo chequea arca-cms.test.ts).
TRA='<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>1791460800</uniqueId><generationTime>2026-10-08T11:50:00.000Z</generationTime><expirationTime>2026-10-08T12:10:00.000Z</expirationTime></header><service>wsfe</service></loginTicketRequest>'

# --- OpenSSL 3.4+ --------------------------------------------------------------
version="$("$OPENSSL" version)"
major="$(printf '%s\n' "$version" | sed -nE 's/^OpenSSL ([0-9]+)\.([0-9]+).*/\1/p')"
minor="$(printf '%s\n' "$version" | sed -nE 's/^OpenSSL ([0-9]+)\.([0-9]+).*/\2/p')"
if [ -z "$major" ] || [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 4 ]; }; then
  echo "Hace falta OpenSSL 3.4 o más nuevo (encontré: $version)." >&2
  echo "En macOS: OPENSSL=/opt/homebrew/bin/openssl $0" >&2
  exit 1
fi
echo "Usando $version"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# Config mínima y explícita: no depende del openssl.cnf de cada máquina.
CNF="$TMP/openssl.cnf"
cat >"$CNF" <<'EOF'
[req]
distinguished_name = dn
string_mask = utf8only
utf8 = yes
prompt = no
[dn]
CN = lo-reemplaza-subj
[leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, nonRepudiation
subjectKeyIdentifier = hash
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[issued]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

echo "== 1. Claves RSA 2048 (PKCS#8). Solo test.key queda en el repo; la de la AC vive en el temporal."
"$OPENSSL" genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$OUT/test.key"
"$OPENSSL" genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP/ca.key"

echo "== 2. CSR de OpenSSL (buildCsr tiene que dar el mismo, byte a byte)"
"$OPENSSL" req -new -key "$OUT/test.key" -config "$CNF" -subj "$PERSONA_SUBJ" -out "$OUT/openssl.csr"

echo "== 3. Certificado autofirmado (mismo sujeto), en PEM y en DER"
"$OPENSSL" req -x509 -new -key "$OUT/test.key" -config "$CNF" -extensions leaf -subj "$PERSONA_SUBJ" \
  -set_serial 0x0123456789ABCDEF -not_before 20260101000000Z -not_after 20360101000000Z \
  -out "$OUT/test.crt"
"$OPENSSL" x509 -in "$OUT/test.crt" -outform DER -out "$OUT/test.crt.der"

echo "== 4. AC de prueba y un certificado «como el de ARCA» (sujeto serialNumber + CN, emisor = la AC)"
"$OPENSSL" req -x509 -new -key "$TMP/ca.key" -config "$CNF" -extensions ca -subj "$CA_SUBJ" \
  -set_serial 0x01 -not_before 20260101000000Z -not_after 20500101000000Z -out "$OUT/ca.crt"
"$OPENSSL" req -new -key "$OUT/test.key" -config "$CNF" -subj "$ISSUED_SUBJ" -out "$TMP/issued.csr"
"$OPENSSL" x509 -req -in "$TMP/issued.csr" -CA "$OUT/ca.crt" -CAkey "$TMP/ca.key" \
  -extfile "$CNF" -extensions issued \
  -set_serial 0x8F3A5C7E9B1D2F40 -not_before 20260910000000Z -not_after 20280910000000Z \
  -out "$OUT/issued.crt"

echo "== 5. PKCS#12 (clave y certificado juntos: lo que la persona NO tiene que subir)"
"$OPENSSL" pkcs12 -export -inkey "$OUT/test.key" -in "$OUT/test.crt" -passout pass:prueba \
  -out "$OUT/test.p12"

echo "== 6. TRA fijo y el CMS de OpenSSL (el comando del manual del WSAA, cap. 5, con -binary)"
printf '%s' "$TRA" >"$OUT/tra.xml"
"$OPENSSL" cms -sign -binary -nodetach -in "$OUT/tra.xml" -signer "$OUT/test.crt" \
  -inkey "$OUT/test.key" -outform DER -out "$OUT/openssl.cms.der"

echo "== 7. Fixtures dorados con NUESTRO código (lib/arca/cms.ts y lib/arca/csr.ts)"
(cd "$ROOT" && npx tsx --conditions=react-server scripts/arca/emit-cms-fixture.ts "$OUT")

echo "== 8. Verificación con OpenSSL de lo que generó nuestro código (va en el PR)"
"$OPENSSL" req -verify -noout -in "$OUT/openssl.csr"
"$OPENSSL" verify -attime "$FIXED_NOW_EPOCH" -CAfile "$OUT/ca.crt" "$OUT/issued.crt"
"$OPENSSL" cms -verify -inform DER -in "$OUT/our.cms.der" -noverify -out "$TMP/our.xml"
cmp "$OUT/tra.xml" "$TMP/our.xml"
echo "our.cms.der: el contenido firmado es idéntico a tra.xml"
"$OPENSSL" cms -verify -inform DER -in "$OUT/our-issued.cms.der" -noverify -out "$TMP/our-issued.xml"
cmp "$OUT/tra.xml" "$TMP/our-issued.xml"
echo "our-issued.cms.der: el contenido firmado es idéntico a tra.xml"
"$OPENSSL" cms -verify -inform DER -in "$OUT/our-issued.cms.der" -CAfile "$OUT/ca.crt" \
  -purpose any -attime "$FIXED_NOW_EPOCH" -out /dev/null
echo "our-issued.cms.der: la cadena valida contra la AC de prueba"
echo "Listo: $OUT"
