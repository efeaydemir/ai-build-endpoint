// api/build.ts — v9.5: Edge + roproxy fallbacks + sağlam debug (asla 500 vermez)
export const config = { runtime: "edge" };

const MAX_RESULTS = 6;
const GAP = 10;
const BASE_Y = 1;

function extractAssetIds(p: string): number[] {
  const ids = new Set<number>();
  const rx = /\b(?:rbxassetid:\/\/|https?:\/\/www\.roblox\.com\/(?:(?:library|catalog))\/)?(\d{6,14})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(p)) !== null) {
    const id = Number(m[1]);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

async function tryFetchJson(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ai-build-endpoint/1.0" } });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, json, text, host: new URL(url).host };
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
  const ids: number[] = [];

  for (const url of tries) {
    try {
      const { status, ok, json, host } = await tryFetchJson(url);
      dbg.push(`${host}=${status}`);
      if (!ok || !json) continue;

      if (Array.isArray(json?.data)) {
        for (const it of json.data) if (it && it.id) ids.push(Number(it.id));
      } else if (Array.isArray(json)) {
        for (const it of json) if (it && (it.AssetId || it.Id || it.id)) ids.push(Number(it.AssetId || it.Id || it.id));
      }
      if (ids.length) break; // ilk başarılı sonuçta çık
    } catch (e: any) {
      try { dbg.push(`${new URL(url).host}_err=${String(e)}`); } catch {}
    }
  }
  return { ids: Array.from(new Set(ids)).slice(0, MAX_RESULTS), debug: dbg.join(" | ") };
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
    const actions: any[] = [];

    // 1) Prompt içindeki link/ID’ler
    let ids = extractAssetIds(prompt);
    let debug = `ids_in_prompt=${ids.join(",")}`;

    // 2) Yoksa katalog araması (roproxy fallback’lı)
    if (ids.length === 0 && prompt.length >= 2) {
      const r = await searchToolbox(prompt);
      ids = r.ids;
      debug += ` | search: ${r.debug} | found=${ids.join(",")}`;
    }

    if (ids.length > 0) {
      // server tarafı baktığın yere ofsetleyecek
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
    // asla 500 verme
    return new Response(JSON.stringify({ actions: [], reason: "exception", detail: String(e?.stack || e) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};
