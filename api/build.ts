// api/build.ts
export const config = { runtime: "edge" };

/**
 * V2: Groq plan + kural tabanlı genişletici
 * - Sıkı modül seti (plaza, roads, gate, river, houses, trees, tower)
 * - Boyut/konum clamp
 * - Aksiyon bütçesi (max 220)
 * - GET'e açıklama döndürür (tarayıcıda 404 yerine bilgi)
 */

const MODEL = "llama-3.1-8b-instant";

const SYSTEM = `
You output a TINY high-level plan for a Roblox plot.
Allowed "modules": plaza, roads, gate, river, houses, trees, tower.
Return STRICT JSON:
{
  "theme": "space|medieval|nature|city",
  "palette": ["#RRGGBB", "..."],    // 3-4 colors
  "modules": [
    {"type":"plaza","size":16},
    {"type":"roads","w":22,"h":18,"gap":8,"width":2},
    {"type":"gate","width":10,"height":8,"thickness":2},
    {"type":"houses","rows":2,"cols":4,"minH":2,"maxH":4}
  ],
  "label": "2-3 words"
}
No prose. No code. Only valid JSON.
`;

// ---- helpers ----
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pick = <T>(arr: T[], i: number) => arr[i % arr.length];
const defaultPal = ["#D0D0D0", "#8A8FFF", "#6CE1FF", "#555555"];

function inferTheme(prompt: string): "space" | "medieval" | "nature" | "city" {
  const p = prompt.toLowerCase();
  if (/(uzay|space|neon|galaksi)/.test(p)) return "space";
  if (/(kale|castle|orta.*çağ|medieval)/.test(p)) return "medieval";
  if (/(doğa|park|orman|nature|forest)/.test(p)) return "nature";
  return "city";
}

function themePalette(theme: string) {
  switch (theme) {
    case "space": return ["#2D2F5F", "#7F89FF", "#6CE1FF", "#B9F2FF"];
    case "medieval": return ["#C2B280", "#8A7B66", "#6B6B6B", "#3F3A36"];
    case "nature": return ["#98C379", "#4CAF50", "#2C6E49", "#6B8E23"];
    default: return ["#D0D0D0", "#777777", "#999999", "#444444"];
  }
}

// rng (deterministic) – aynı prompt benzer düzen üretir
function rngFrom(str: string) {
  let h = 2166136261; for (let i=0;i<str.length;i++) { h ^= str.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24); }
  let s = h >>> 0;
  return () => (s = (s*1664525 + 1013904223) >>> 0) / 2**32;
}

// clamp + sanitize plan
function sanitizePlan(userPrompt: string, plan: any) {
  const theme = inferTheme(userPrompt);
  const pal = Array.isArray(plan?.palette) && plan.palette.length >= 3 ? plan.palette : themePalette(theme);
  const modulesIn: any[] = Array.isArray(plan?.modules) ? plan.modules : [];

  // yalnızca izinli modüller + güvenli aralıklar
  const modules: any[] = [];
  for (const m of modulesIn) {
    if (!m || !m.type) continue;
    if (m.type === "plaza") {
      modules.push({ type:"plaza", size: clamp(Number(m.size ?? 16), 12, 28) });
    }
    if (m.type === "roads") {
      modules.push({
        type:"roads",
        w: clamp(Number(m.w ?? 20), 10, 40),
        h: clamp(Number(m.h ?? 20), 10, 40),
        gap: clamp(Number(m.gap ?? 8), 6, 20),
        width: clamp(Number(m.width ?? 2), 2, 6)
      });
    }
    if (m.type === "gate") {
      modules.push({
        type:"gate",
        width: clamp(Number(m.width ?? 10), 6, 16),
        height: clamp(Number(m.height ?? 8), 6, 16),
        thickness: clamp(Number(m.thickness ?? 2), 1, 4)
      });
    }
    if (m.type === "river") {
      modules.push({
        type:"river",
        length: clamp(Number(m.length ?? 36), 20, 60),
        width: clamp(Number(m.width ?? 4), 3, 10)
      });
    }
    if (m.type === "houses") {
      modules.push({
        type:"houses",
        rows: clamp(Number(m.rows ?? 2), 1, 3),
        cols: clamp(Number(m.cols ?? 4), 2, 6),
        minH: clamp(Number(m.minH ?? 2), 1, 4),
        maxH: clamp(Number(m.maxH ?? 4), 2, 8)
      });
    }
    if (m.type === "trees") {
      modules.push({
        type:"trees",
        count: clamp(Number(m.count ?? 12), 6, 40),
        ringR: clamp(Number(m.ringR ?? 12), 8, 28)
      });
    }
    if (m.type === "tower") {
      modules.push({
        type:"tower",
        floors: clamp(Number(m.floors ?? 3), 1, 6),
        radius: clamp(Number(m.radius ?? 4), 2, 8)
      });
    }
  }

  // Heuristik: prompta göre eksikleri tamamla
  const p = userPrompt.toLowerCase();
  const types = new Set(modules.map(m => m.type));
  if (!types.has("plaza")) modules.unshift({ type:"plaza", size: 18 });
  if (/kap[ıi]/.test(p) && !types.has("gate")) modules.push({ type:"gate", width: 10, height: 8, thickness: 2 });
  if (/(nehir|river|dere)/.test(p) && !types.has("river")) modules.push({ type:"river", length: 40, width: 5 });
  if (/(park|doğa|ağaç|trees|forest)/.test(p) && !types.has("trees")) modules.push({ type:"trees", count: 18, ringR: 14 });
  if (/(şehir|city|sokak|yol|road)/.test(p) && !types.has("roads")) modules.push({ type:"roads", w: 22, h: 18, gap: 8, width: 2 });
  if (/(kale|castle|orta.*çağ|medieval)/.test(p) && !types.has("tower")) modules.push({ type:"tower", floors: 4, radius: 5 });
  if (!types.has("houses") && /ev|house|market|pazar|sokak/.test(p)) modules.push({ type:"houses", rows: 2, cols: 4, minH: 2, maxH: 4 });

  return {
    theme,
    palette: pal,
    modules,
    label: typeof plan?.label === "string" && plan.label.length <= 24 ? plan.label : (
      theme === "space" ? "Lunar Plaza" :
      theme === "medieval" ? "Old Town" :
      theme === "nature" ? "Green Park" : "City Square"
    )
  };
}

// ---- expanders -> actions ----
type Act = { type: string; [k: string]: any };
function addPlaza(actions: Act[], palette: string[], size: number) {
  actions.push({ type:"PLACE_BLOCK", block:"Concrete", pos:[0,1,0], size:[size,1,size], color: palette[0] });
  actions.push({ type:"LABEL", text:"AI Plaza", pos:[0,4,0] });
  const k = size/2 - 2;
  for (const [x,z] of [[k,k],[-k,k],[k,-k],[-k,-k]] as const) {
    actions.push({ type:"PLACE_MODEL", key:"StreetLamp", pos:[x,1,z], yaw:0 });
  }
}

function addRoads(actions: Act[], palette: string[], w: number, h: number, gap: number, width: number) {
  // çizgi şeklinde yollar (uzun bloklar)
  // düşey caddeler
  for (let x=-w; x<=w; x+=gap) {
    actions.push({ type:"PLACE_BLOCK", block:"Slate", pos:[x,1,0], size:[width,0.4,(h*2)+width], color: palette[3] });
  }
  // yatay caddeler
  for (let z=-h; z<=h; z+=gap) {
    actions.push({ type:"PLACE_BLOCK", block:"Slate", pos:[0,1,z], size:[(w*2)+width,0.4,width], color: palette[3] });
  }
}

function addGate(actions: Act[], palette: string[], width: number, height: number, thickness: number) {
  // basit kemer kapı (şehir duvarı gibi)
  const half = Math.floor(width/2);
  // iki kolon
  actions.push({ type:"PLACE_BLOCK", block:"Rock", pos:[-half,1, - (Math.max(6, thickness))], size:[2,height,thickness], color: palette[2] });
  actions.push({ type:"PLACE_BLOCK", block:"Rock", pos:[ half,1, - (Math.max(6, thickness))], size:[2,height,thickness], color: palette[2] });
  // kemer üstü
  actions.push({ type:"PLACE_BLOCK", block:"Rock", pos:[0,height, - (Math.max(6, thickness))], size:[width,2,thickness], color: palette[2] });
}

function addRiver(actions: Act[], length: number, width: number) {
  // Z ekseninde akan basit dikdörtgen nehir
  actions.push({ type:"TERRAIN_BOX", material:"Grass", min:[-length/2,0,-width/2], max:[length/2,0.2,width/2] });
}

function addHouses(actions: Act[], rng: () => number, rows: number, cols: number, minH: number, maxH: number, palette: string[]) {
  const spacing = 6;
  const startX = -((cols-1)*spacing)/2;
  const startZ = 12; // plazanın kuzeyi
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const h = Math.round(minH + rng()*(maxH-minH));
      const w = 4, d = 4;
      const x = startX + c*spacing;
      const z = startZ + r*spacing;
      actions.push({ type:"PLACE_BLOCK", block:"SmoothPlastic", pos:[x,1,z], size:[w, h, d], color: pick(palette, 1) });
    }
  }
}

function addTrees(actions: Act[], count: number, ringR: number) {
  for (let i=0;i<count;i++){
    const a = (i/count)*Math.PI*2;
    const x = Math.cos(a)*ringR;
    const z = Math.sin(a)*ringR;
    // gövde
    actions.push({ type:"PLACE_BLOCK", block:"Rock", pos:[x,1,z], size:[1,3,1], color:"#6B4F2A" });
    // yaprak küp
    actions.push({ type:"PLACE_BLOCK", block:"Grass", pos:[x,3.5,z], size:[3,3,3], color:"#3BAA3B" });
  }
}

function addTower(actions: Act[], palette: string[], floors: number, radius: number) {
  for (let f=1; f<=floors; f++){
    const y = f*2;
    const count = 24;
    for (let i=0;i<count;i++){
      const a = (i/count)*Math.PI*2;
      const x = Math.cos(a)*radius, z = Math.sin(a)*radius;
      actions.push({ type:"PLACE_BLOCK", block:"Neon", pos:[x,y,z], size:[2,2,2], color: pick(palette, 1) });
    }
    actions.push({ type:"PLACE_BLOCK", block:"Neon", pos:[0,y+1,0], size:[2,2,2], color: pick(palette, 2) });
  }
}

// ---- main handler ----
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: true,
      msg: "POST JSON body bekleniyor: { obs: { prompt: '...' } }"
    }), { status: 200, headers: { "Content-Type":"application/json" }});
  }

  try {
    const { obs } = await req.json(); // { prompt, grid }
    const userPrompt = String(obs?.prompt || "").slice(0, 200);
    const r = rngFrom(userPrompt);

    // 1) Groq'tan küçük plan (ama yalnızca fikir olarak kullanıyoruz)
    let llmPlan: any = {};
    try {
      const llm = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY!}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `PROMPT: ${userPrompt}` }
          ]
        })
      });
      if (llm.ok) {
        const comp = await llm.json();
        llmPlan = JSON.parse(comp.choices?.[0]?.message?.content || "{}");
      }
    } catch { /* plan yoksa da sorun değil */ }

    // 2) Planı temizle + tamamla
    const plan = sanitizePlan(userPrompt, llmPlan);
    const actions: Act[] = [];

    // 3) Modülleri sırayla uygula
    for (const m of plan.modules) {
      if (actions.length > 220) break; // bütçe
      switch (m.type) {
        case "plaza": addPlaza(actions, plan.palette, m.size); break;
        case "roads": addRoads(actions, plan.palette, m.w, m.h, m.gap, m.width); break;
        case "gate": addGate(actions, plan.palette, m.width, m.height, m.thickness); break;
        case "river": addRiver(actions, m.length, m.width); break;
        case "houses": addHouses(actions, r, m.rows, m.cols, m.minH, m.maxH, plan.palette); break;
        case "trees": addTrees(actions, m.count, m.ringR); break;
        case "tower": addTower(actions, plan.palette, m.floors, m.radius); break;
      }
    }

    // son etiket
    actions.push({ type:"LABEL", text: plan.label, pos:[0, 5, 0] });

    return new Response(JSON.stringify({ actions, reason:"v2 plan->expand (clamped)" }),
      { status: 200, headers: { "Content-Type":"application/json" }});
  } catch (e: any) {
    return new Response(JSON.stringify({
      actions:[{type:"LABEL", text:"AI error", pos:[0,4,0]}],
      reason:"exception",
      detail:String(e)
    }), { status: 200, headers: { "Content-Type":"application/json" }});
  }
};
