// api/build.ts — v8: NO-LLM, Toolbox search → PLACE_ASSET only
export const config = { runtime: "edge" };

const MAX_RESULTS = 6;     // en fazla kaç model koyalım
const GAP = 10;            // aralarındaki mesafe
const BASE_Y = 1;

function extractAssetIds(p:string): number[] {
  const ids = new Set<number>();
  const rx = /\b(?:rbxassetid:\/\/|https?:\/\/www\.roblox\.com\/(?:library|catalog)\/)?(\d{6,14})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(p)) !== null) { const id = Number(m[1]); if (id) ids.add(id); }
  return Array.from(ids);
}

async function searchToolbox(keyword:string): Promise<number[]> {
  const ids:number[] = [];
  const k = encodeURIComponent(keyword.trim());
  try {
    const r = await fetch(`https://catalog.roblox.com/v1/search/items/details?Category=Models&Limit=${MAX_RESULTS}&Keyword=${k}`, {
      headers: { "Accept":"application/json", "User-Agent":"ai-build-endpoint/1.0" }
    });
    if (r.ok) {
      const j:any = await r.json();
      for (const it of (j.data||[])) if (it && it.id) ids.push(Number(it.id));
    }
  } catch {}
  // fallback eski endpoint
  if (ids.length === 0) {
    try {
      const r = await fetch(`https://search.roblox.com/catalog/json?Category=Models&Keyword=${k}`, {
        headers: { "Accept":"application/json", "User-Agent":"ai-build-endpoint/1.0" }
      });
      if (r.ok) {
        const arr:any[] = await r.json();
        for (const it of (arr||[])) if (it and it.AssetId) ids.push(Number(it.AssetId));
      }
    } catch {}
  }
  return ids.slice(0, MAX_RESULTS);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ok:true,msg:"POST { obs:{ prompt:'stone' } }"}), { status:200, headers:{"Content-Type":"application/json"}});
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 200).trim();

    // 1) prompt içinde link/ID varsa onları kullan
    let ids = extractAssetIds(prompt);

    // 2) yoksa prompt'u direkt arama terimi olarak kullan
    if (ids.length === 0 && prompt.length >= 2) {
      ids = await searchToolbox(prompt);
    }

    // 3) hiç bir şey bulunamadıysa boş dön (oyun side no-op)
    if (ids.length === 0) {
      return new Response(JSON.stringify({ actions: [], reason:"no-results" }), {status:200, headers:{"Content-Type":"application/json"}});
    }

    // 4) sonuçları 3x2 ızgarada yerleştir
    const actions:any[] = [];
    for (let i=0;i<Math.min(MAX_RESULTS, ids.length); i++) {
      const col = i % 3, row = Math.floor(i/3);
      const x = (col-1) * GAP;
      const z = row * GAP;
      actions.push({ type:"PLACE_ASSET", assetId: ids[i], pos:[x, BASE_Y, z], yaw: 0 });
    }

    return new Response(JSON.stringify({ actions, reason:"toolbox-only" }), { status:200, headers:{"Content-Type":"application/json"}});
  } catch (e:any) {
    return new Response(JSON.stringify({ actions: [], reason:"exception", detail:String(e) }), { status:200, headers:{"Content-Type":"application/json"}});
  }
};
