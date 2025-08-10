// api/build.ts — v10: Open Cloud Toolbox (x-api-key), proxy fallback, PLACE_ASSET only
export const config = { runtime: "edge" };

const MAX_RESULTS = 6;
const GAP = 10;
const BASE_Y = 1;

function idsFromAnything(obj: any): number[] {
  const out: number[] = [];
  const push = (v: any) => {
    const n = Number(v?.itemTargetId ?? v?.assetId ?? v?.AssetId ?? v?.Id ?? v?.id);
    if (Number.isFinite(n)) out.push(n);
  };
  const walk = (x: any) => {
    if (!x) return;
    if (Array.isArray(x)) { for (const it of x) walk(it); return; }
    if (typeof x === "object") { push(x); for (const k in x) walk((x as any)[k]); }
  };
  walk(obj);
  return Array.from(new Set(out));
}

function idsFromText(text: string): number[] {
  const s = new Set<number>();
  const rx1 = /\b(?:itemTargetId|assetId|AssetId|Id|id)"?\s*:\s*(\d{6,14})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx1.exec(text)) !== null) s.add(Number(m[1]));
  const rx2 = /\/catalog\/(\d{6,14})(?:\/|")/g;
  while ((m = rx2.exec(text)) !== null) s.add(Number(m[1]));
  return Array.from(s);
}

async function tryJson(url: string, headers?: Record<string, string>) {
  const r = await fetch(url, { headers });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, j, t, host: new URL(url).host };
}

async function searchOpenCloud(query: string): Promise<{ ids: number[]; debug: string }> {
  const k = encodeURIComponent(query);
  const key = (process.env as any).OPEN_CLOUD_KEY;
  const dbg: string[] = [];
  let ids: number[] = [];

  if (key) {
    const url = `https://apis.roblox.com/toolbox-service/v2/assets:search?searchCategoryType=Model&query=${k}&limit=${MAX_RESULTS}`;
    const { ok, status, j, t } = await tryJson(url, { "x-api-key": String(key), "content-type": "application/json" });
    dbg.push(`apis.roblox.com=${status}`);
    if (ok) {
      ids = idsFromAnything(j);
      if (!ids.length) ids = idsFromText(t);
    } else {
      dbg.push("opencloud_failed");
    }
  } else {
    dbg.push("no_OPEN_CLOUD_KEY_env");
  }

  // Proxy fallback’ları (kimliksiz)
  if (!ids.length) {
    const tries = [
      `https://catalog.rprxy.xyz/v2/search/items/details?categoryFilter=CommunityCreations&limit=${MAX_RESULTS}&keyword=${k}`,
      `https://search.rprxy.xyz/catalog/json?Category=Models&Keyword=${k}`,
      `https://web.rprxy.xyz/catalog?Category=Models&Keyword=${k}`
    ];
    for (const url of tries) {
      const { ok, status, j, t, host } = await tryJson(url);
      dbg.push(`${host}=${status}`);
      if (!ok) continue;
      ids = idsFromAnything(j);
      if (!ids.length) ids = idsFromText(t);
      if (ids.length) break;
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

    const { ids, debug } = await searchOpenCloud(prompt);

    if (ids.length) {
      const actions: any[] = [];
      for (let i = 0; i < Math.min(MAX_RESULTS, ids.length); i++) {
        const col = i % 3, row = Math.floor(i / 3);
        actions.push({ type: "PLACE_ASSET", assetId: ids[i], pos: [(col - 1) * GAP, BASE_Y, row * GAP], yaw: 0 });
      }
      return new Response(JSON.stringify({ actions, reason: "toolbox", detail: `found=${ids.join(",")} | ${debug}` }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // boş kalmasın
    return new Response(JSON.stringify({
      actions: [
        { type: "PLACE_BLOCK", block: "Concrete", pos: [0, 1, 0], size: [16, 1, 16], color: "#D0D0D0" }
      ],
      reason: "fallback", detail: debug
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ actions: [], reason: "exception", detail: String(e?.stack || e) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};
