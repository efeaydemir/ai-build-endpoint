// api/build.ts — v9.7: Edge + roproxy + JSON/HTML scraping (asla 500 vermez)
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
  const r = await fetch(url, { headers: { Accept: "application/json,text/html,*/*", "User-Agent": "ai-build-endpoint/1.0" } });
  const text = await r.text();
  let json: any = null;
  try { json = text && text.trim().startsWith("{") ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json, text, host: new URL(url).host };
}

function collectIdsFromJson(json: any): number[] {
  const out: number[] = [];
  if (!json) return out;
  const push = (it: any) => {
    const v = Number(it?.itemTargetId ?? it?.AssetId ?? it?.assetId ?? it?.id ?? it?.Id);
    if (Number.isFinite(v)) out.push(v);
  };
  if (Array.isArray(json?.data)) for (const it of json.data) push(it);
  else if (Array.isArray(json)) for (const it of json) push(it);
  else if (json?.data && typeof json.data === "object") push(json.data);
  return out;
}

function collectIdsFromText(text: string): number[] {
  const out = new Set<number>();
  // JSON benzeri: "itemTargetId": 123..., "AssetId": 123...
  let rx = /\b(?:itemTargetId|AssetId|assetId|Id|id)"?\s*:\s*(\d{6,14})\b/g; let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) out.add(Number(m[1]));
  // HTML sayfası linkleri: /catalog/123456789/
  rx = /\/catalog\/(\d{6,14})(?:\/|")/g;
  while ((m = rx.exec(text)) !== null) out.add(Number(m[1]));
  // data-asset-id="123456"
  rx = /data-asset-id=["']?(\d{6,14})["']?/g;
  while ((m = rx.exec(text)) !== null) out.add(Number(m[1]));
  return Array.from(out);
}

async function searchToolbox(keyword: string): Promise<{ ids: number[]; debug: string }> {
  const k = encodeURIComponent(keyword.trim());
  const apiTries = [
    // modern
    `https://catalog.roblox.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    `https://catalog.roproxy.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    `https://catalog.rprxy.xyz/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
    // legacy
    `https://search.roblox.com/catalog/json?Category=Models&Keyword=${k}`,
    `https://search.roproxy.com/catalog/json?Category=Models&Keyword=${k}`,
    `https://search.rprxy.xyz/catalog/json?Category=Models&Keyword=${k}`,
  ];

  const pageTries = [
    `https://www.roproxy.com/catalog?Category=Models&Keyword=${k}`,
    `https://web.rprxy.xyz/catalog?Category=Models&Keyword=${k}`,
  ];

  const dbg: string[] = [];
  let ids: number[] = [];

  // 1) JSON API zinciri
  for (const url of apiTries) {
    try {
      const { ok, status, json, text, host } = await tryFetch(url);
      dbg.push(`${host}=${status}`);
      if (!ok) continue;
      ids = collectIdsFromJson(json);
      if (!ids.length) ids = collectIdsFromText(text);
      if (ids.length) break;
    } catch (e: any) { try { dbg.push(`${new URL(url).host}_err=${String(e)}`); } catch {} }
  }

  // 2) Olmazsa HTML sayfası kazı
  if (!ids.length) {
    for (const url of pageTries) {
      try {
        const { ok, status, text, host } = await tryFetch(url);
        dbg.push(`${host}=${status}`);
        if (!ok) continue;
        ids = collectIdsFromText(text);
        if (ids.length) break;
      } catch (e: any) { try { dbg.push(`${new URL(url).host}_err=${String(e)}`); } catch {} }
    }
  }

  // benzersiz + limit
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

    // 1) Prompt’tan direkt id/link
    let ids = extractAssetIdsFromPrompt(prompt);
    let debug = `ids_in_prompt=${ids.join(",")}`;

    // 2) Yoksa arama (JSON → HTML scrape)
    if (ids.length === 0 && prompt.length >= 2) {
      const r = await searchToolbox(prompt);
      ids = r.ids; debug += ` | search: ${r.debug} | found=${ids.join(",")}`;
    }

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

    // 3) Fallback (boş dönme yok)
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
