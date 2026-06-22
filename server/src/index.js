// Ludex License Server — Cloudflare Worker
// ------------------------------------------------------------------
// Valida a license no Gumroad (com o token guardado AQUI, fora do app)
// e devolve um TOKEN ASSINADO (Ed25519). O app Ludex verifica a assinatura
// com a chave PÚBLICA embutida — forjar o token sem a chave PRIVADA (que só
// existe aqui, como secret) é impossível. Isso mata:
//   1. Forja de estado local (PC validated_at / Android android_admin_unlock)
//   2. Token do Gumroad extraível do binário (agora fica só no servidor)
//   3. Vazamento de /v2/sales (o app nunca mais fala com o Gumroad)
//
// Secrets necessários (wrangler secret put):
//   GUMROAD_TOKEN        — access token do Gumroad
//   ED25519_PRIVATE_HEX  — seed de 32 bytes (hex) da chave privada
// Vars (wrangler.toml [vars]):
//   GUMROAD_PRODUCT_ID   — permalink do produto
//   ADMIN_EMAIL          — email admin (bypassa limite de device)
//   TOKEN_TTL_DAYS       — validade do token (ex: "14")
//   MAX_DEVICES          — máx de dispositivos por key (ex: "5")

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
// @noble/ed25519 v2 precisa do hook de sha512 (síncrono) p/ funcionar no Worker
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    if (request.method !== "POST") return jsonResponse({ error: "POST only" }, 405);
    const url = new URL(request.url);
    if (url.pathname !== "/token") return jsonResponse({ error: "not found" }, 404);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "bad json" }, 400); }
    const key = String(body.license_key || "").trim();
    const device = String(body.device_id || "").trim().slice(0, 128);
    if (!key || !device) return jsonResponse({ error: "missing license_key or device_id" }, 400);

    // 1) Valida no Gumroad (token fica AQUI, nunca no app) ----------------
    const form = new URLSearchParams();
    form.set("product_id", env.GUMROAD_PRODUCT_ID);
    form.set("license_key", key);
    form.set("increment_uses_count", "false"); // o limite de device é gerido pelo token, não pelo uses do Gumroad
    let data;
    try {
      const gr = await fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.GUMROAD_TOKEN}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      data = await gr.json();
    } catch (e) {
      return jsonResponse({ error: "gumroad unreachable" }, 502);
    }
    if (!data.success) return jsonResponse({ error: data.message || "invalid license" }, 403);

    const purchase = data.purchase || {};
    if (purchase.refunded || purchase.chargebacked || purchase.disputed) {
      return jsonResponse({ error: "license refunded/disputed" }, 403);
    }
    const now = Math.floor(Date.now() / 1000);

    // 1.5) Limite de dispositivos por key (anti-compartilhamento) ---------
    // KV guarda, por key, um mapa { device_id: last_seen }. Dispositivos sem
    // ativar há DEVICE_PRUNE_DAYS liberam a vaga sozinhos (não tranca quem
    // reinstala/troca de aparelho). Um device já conhecido sempre renova.
    if (env.DEVICES) {
      const maxDevices = parseInt(env.MAX_DEVICES || "3", 10);
      const pruneSecs = parseInt(env.DEVICE_PRUNE_DAYS || "45", 10) * 86400;
      const keyHash = await sha256Hex(key); // chave do KV (não vaza a key inteira)
      let map = {};
      try {
        const raw = await env.DEVICES.get(keyHash);
        if (raw) map = JSON.parse(raw);
      } catch (_) { map = {}; }
      // poda inativos
      for (const [d, ts] of Object.entries(map)) {
        if (now - ts > pruneSecs) delete map[d];
      }
      const known = Object.prototype.hasOwnProperty.call(map, device);
      if (!known && Object.keys(map).length >= maxDevices) {
        return jsonResponse({
          error: `Limite de ${maxDevices} dispositivos atingido para essa license. Pare de usar em um aparelho (a vaga libera após ${env.DEVICE_PRUNE_DAYS || "45"} dias sem uso) ou compre outra license.`,
          device_limit: maxDevices,
        }, 403);
      }
      map[device] = now;
      try { await env.DEVICES.put(keyHash, JSON.stringify(map)); } catch (_) {}
    }

    // 2) Monta + assina o token (Ed25519) --------------------------------
    // v1.1.0: sem flag de admin — todo comprador é tratado igual.
    const ttlDays = parseInt(env.TOKEN_TTL_DAYS || "14", 10);
    const payloadObj = {
      v: 1,
      k: (await sha256Hex(key)).slice(0, 16), // hash curto da key (não vaza a key inteira)
      d: device,
      iat: now,
      exp: now + ttlDays * 86400,
    };
    const payloadB64 = b64url(enc.encode(JSON.stringify(payloadObj)));
    const priv = hexToBytes(env.ED25519_PRIVATE_HEX);
    const sig = ed.sign(enc.encode(payloadB64), priv); // assina os BYTES do payload-b64
    const token = `${payloadB64}.${b64url(sig)}`;

    return jsonResponse({ token, exp: payloadObj.exp });
  },
};
