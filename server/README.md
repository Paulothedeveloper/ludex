# Ludex License Server (Cloudflare Worker)

Servidor de **token assinado** (Ed25519) pra licença do Ludex. O app nunca mais
fala com o Gumroad direto, e o estado de licença local não pode mais ser forjado.

## Por que existe

Antes: o app chamava o Gumroad **direto**, com o access token **embutido no binário**.
Problemas: (1) o estado de "licenciado" ficava num arquivo/registro **forjável**;
(2) o token do Gumroad era **extraível** do `.exe`; (3) com ele dava pra listar
**email de todos os compradores** (`/v2/sales`).

Agora: o app manda `license_key + device_id` pra cá. O Worker valida no Gumroad
(token fica **aqui**, como secret) e devolve um **token assinado** com a chave
**privada** Ed25519. O app verifica a assinatura com a chave **pública** embutida.
Sem a privada (que só existe aqui), **não dá pra forjar**.

## Deploy (uma vez)

Precisa de uma conta Cloudflare (free). Tudo via CLI:

```bash
cd server
npm install

# 1) login no Cloudflare
npx wrangler login

# 2) ajuste as [vars] no wrangler.toml (GUMROAD_PRODUCT_ID, ADMIN_EMAIL, MAX_DEVICES)

# 3) setar os SECRETS (não vão pro repo):
npx wrangler secret put GUMROAD_TOKEN
#   cole o access token do Gumroad

npx wrangler secret put ED25519_PRIVATE_HEX
#   cole a SEED de 32 bytes (hex) da chave privada

# 4) deploy
npx wrangler deploy
```

No fim ele imprime a URL, ex: `https://ludex-license.SEU-SUBDOMINIO.workers.dev`.
Essa URL vai embutida no app (const `LICENSE_SERVER_URL` no `lib.rs`), junto com a
**chave pública** (`LICENSE_PUBLIC_KEY_HEX`).

## Gerar o par de chaves

Rode no SEU terminal (a privada nunca deve sair daqui):

```bash
node -e 'const c=require("crypto");const{publicKey,privateKey}=c.generateKeyPairSync("ed25519");console.log("PUB ",publicKey.export({type:"spki",format:"der"}).slice(-32).toString("hex"));console.log("PRIV",privateKey.export({type:"pkcs8",format:"der"}).slice(-32).toString("hex"))'
```

- `PRIV` → `npx wrangler secret put ED25519_PRIVATE_HEX`
- `PUB`  → embutida no app (me passa que eu coloco no `lib.rs`)

## Testar

```bash
curl -X POST https://SEU-WORKER.workers.dev/token \
  -H 'content-type: application/json' \
  -d '{"license_key":"UMA-KEY-VALIDA","device_id":"teste-123"}'
# -> {"token":"...assinado...","exp":1234567890,"admin":false}
```

## Formato do token

`base64url(payload).base64url(assinatura)` — payload:
```json
{ "v":1, "k":"<hash16 da key>", "d":"<device_id>", "adm":false, "iat":..., "exp":... }
```
A assinatura é sobre os **bytes do `base64url(payload)`**. O app valida com a
chave pública, confere `exp` e `d == device_id` da máquina.
