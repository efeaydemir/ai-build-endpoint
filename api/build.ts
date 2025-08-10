// api/build.ts — v9.6: Edge + roproxy + sağlam JSON/regex çıkarımı (asla 500 vermez)
export const config = { runtime: "edge" };

const MAX_RESULTS = 6;
const GAP = 10;
const BASE_Y = 1;

function extractAssetIdsFromPrompt(p: string): number[] {
  const ids = new Set<number>();
  const rx = /\b(?:rbxassetid:\/\/|https?:\/\/www\.roblox\.com\/(?:(?:library|catalog))\/)?(\d{6,14})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(p)) !== null) { const id = Number(m[1]); if (id) ids.add(id); }
  return Array.from(ids);
}

async function tryFetch(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ai-build-endpoint/1.0" } });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* body HTML olabilir */ }
  return { ok: r.ok, status: r.status, json, text, host: new URL(url).host };
}

function collectIdsFromJson(json: any): number[] {
  const out: number[] = [];
  if (!json) return out;
  const push = (v: any) => {
    const cand = Number(v?.itemTargetId ?? v?.AssetId ?? v?.assetId ?? v?.id ?? v?.Id);
    if (cand && Number.isFinite(cand)) out.push(cand);
  };
  if (Array.isArray(json?.data)) {
    for (const it of json.data) push(it);
  } else if (Array.isArray(json)) {
    for (const it of json) push(it);
  } else if (json?.data && typeof json.data === "object") {
    // bazı proxy’ler tek obje döndürebiliyor
    push(json.data);
  }
  return out;
}

function collectIdsFromText(text: string): number[] {
  const out = new Set<number>();
  const rx = /\b(?:itemTargetId|AssetId|assetId|Id|id)"?\s*:\s*(\d{6,14})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) { const id = Number(m[1]); if (id) out.add(id); }
  return Array.from(out);
}

async function searchToolbox(keyword: string): Promise<{ ids: number[]; debug: string }> {
  const k = encodeURIComponent(keyword.trim());
  const tries = [
    // modern
    `https://catalog.roblox.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    `https://catalog.roproxy.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    `https://catalog.rprxy.xyz/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    // legacy
    `https://search.roblox.com/catalog/json?Category=Models&Keyword=${k}`,
    `https://search.roproxy.com/catalog/json?Category=Models&Keyword=${k}`,
    `https://search.rprxy.xyz/catalog/json?Category=Models&Keyword=${k}`,
  ];

  const dbg: string[] = [];
  let ids: number[] = [];

  for (const url of tries) {
    try {
      const { ok, status, json, text, host } = await tryFetch(url);
      dbg.push(`${host}=${status}`);
      if (!ok) continue;

      // önce temiz JSON’dan dene
      ids = collectIdsFromJson(json);
      if (!ids.length) {
        // JSON yoksa / sahteyse metinden sök
        ids = collectIdsFromText(text);
      }
      if (ids.length) break;
    } catch (e: any) {
      try { dbg.push(`${new URL(url).host}_err=${String(e)}`); } catch {}
    }
  }

  // benzersiz ve limitli
  ids = Array.from(new Set(ids)).slice(0, MAX_RESULTS);
  return { ids, debug: dbg.join(" | ") };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true, msg: "POST { obs:{ prompt:'stone' } }" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 200).trim();

    // 1) Prompt içindeki direkt ID/link
    let ids = extractAssetIdsFromPrompt(prompt);
    let debug = `ids_in_prompt=${ids.join(",")}`;

    // 2) Yoksa proxy zinciriyle ara
    if (ids.length === 0 && prompt.length >= 2) {
      const r = await searchToolbox(prompt);
      ids = r.ids;
      debug += ` | search: ${r.debug} | found=${ids.join(",")}`;
    }

    // 3) Actions
    const actions: any[] = [];
    if (ids.length > 0) {
      for (let i = 0; i < Math.min(MAX_RESULTS, ids.length); i++) {
        const col = i % 3, row = Math.floor(i / 3);
        actions.push({ type: "PLACE_ASSET", assetId: ids[i], pos: [(col - 1) * GAP, BASE_Y, row * GAP], yaw: 0 });
      }
      return new Response(JSON.stringify({ actions, reason: "toolbox", detail: debug }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // 4) Fallback – boş dönmesin
    actions.push({ type: "PLACE_BLOCK", block: "Concrete", pos: [0, 1, 0], size: [16, 1, 16], color: "#D0D0D0" });
    actions.push({ type: "PLACE_MODEL", key: "Bench", pos: [-3, 1, 0], yaw: 0 });
    actions.push({ type: "PLACE_MODEL", key: "Bench", pos: [3, 1, 0], yaw: 180 });
    return new Response(JSON.stringify({ actions, reason: "fallback", detail: debug }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ actions: [], reason: "exception", detail: String(e?.stack || e) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};
