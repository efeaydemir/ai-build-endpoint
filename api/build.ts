// api/build.ts — v9.2: toolbox-only, fixed "&&", never 500
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

async function searchToolbox(keyword: string): Promise<{ ids: number[]; debug: string }> {
  const dbg: string[] = [];
  const ids: number[] = [];
  const k = encodeURIComponent(keyword.trim());

  // Modern catalog API
  try {
    const r = await fetch(
      `https://catalog.roblox.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`,
      { headers: { Accept: "application/json", "User-Agent": "ai-build-endpoint/1.0" } }
    );
    dbg.push(`catalog=${r.status}`);
    if (r.ok) {
      const j: any = await r.json();
      const arr = Array.isArray(j.data) ? j.data : [];
      for (const it of arr) {
        if (it && it.id) ids.push(Number(it.id));
      }
    }
  } catch (e: any) {
    dbg.push(`catalog_err=${String(e)}`);
  }

  // Legacy fallback
  if (ids.length === 0) {
    try {
      const r = await fetch(
        `https://search.roblox.com/catalog/json?Category=Models&Keyword=${k}`,
        { headers: { Accept: "application/json", "User-Agent": "ai-build-endpoint/1.0" } }
      );
      dbg.push(`legacy=${r.status}`);
      if (r.ok) {
        const arr: any[] = await r.json();
        for (const it of arr || []) {
          if (it && it.AssetId) ids.push(Number(it.AssetId)); // <-- FIX: '&&' kullanıldı
        }
      }
    } catch (e: any) {
      dbg.push(`legacy_err=${String(e)}`);
    }
  }

  return { ids: ids.slice(0, MAX_RESULTS), debug: dbg.join(" | ") };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true, msg: "POST { obs:{ prompt:'stone' } }" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 200).trim();

    // 1) Prompt içinde direkt ID/link varsa onları kullan
    let ids = extractAssetIds(prompt);
    let debug = `ids_in_prompt=${ids.join(",")}`;

    // 2) Yoksa prompt'u anahtar kelime olarak ara
    if (ids.length === 0 && prompt.length >= 2) {
      const r = await searchToolbox(prompt);
      ids = r.ids;
      debug += ` | search: ${r.debug} | found=${ids.join(",")}`;
    }

    const actions: any[] = [];

    if (ids.length > 0) {
      // 3x2 grid yerleşim
      for (let i = 0; i < Math.min(MAX_RESULTS, ids.length); i++) {
        const col = i % 3,
          row = Math.floor(i / 3);
        const x = (col - 1) * GAP;
        const z = row * GAP;
        actions.push({ type: "PLACE_ASSET", assetId: ids[i], pos: [x, BASE_Y, z], yaw: 0 });
      }
      return new Response(JSON.stringify({ actions, reason: "toolbox", detail: debug }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3) GARANTİLİ FALLBACK – boş dönme, 200 dön
    actions.push({ type: "PLACE_BLOCK", block: "Concrete", pos: [0, 1, 0], size: [16, 1, 16], color: "#D0D0D0" });
    actions.push({ type: "PLACE_MODEL", key: "Bench", pos: [-3, 1, 0], yaw: 0 });
    actions.push({ type: "PLACE_MODEL", key: "Bench", pos: [3, 1, 0], yaw: 180 });
    return new Response(JSON.stringify({ actions, reason: "fallback", detail: debug }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    // Asla 500 verme → Roblox PostAsync patlamasın
    return new Response(JSON.stringify({ actions: [], reason: "exception", detail: String(e?.stack || e) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};
