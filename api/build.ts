// api/build.ts — v11.0: ChatGPT (Structured Outputs) → actions[]
export const config = { runtime: "edge" };

const MODEL = "gpt-4o-mini"; // hızlı & uygun
const MAX_ACTIONS = 200;

type Action =
  | { type: "PLACE_BLOCK"    ; pos: [number,number,number]; size: [number,number,number]; yaw?: number; color?: string; material?: string; group?: string }
  | { type: "PLACE_WEDGE"    ; pos: [number,number,number]; size: [number,number,number]; yaw?: number; color?: string; material?: string; group?: string }
  | { type: "PLACE_CYLINDER" ; pos: [number,number,number]; size: [number,number,number]; yaw?: number; color?: string; material?: string; group?: string };

const schema = {
  name: "ai_build_actions",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      actions: {
        type: "array",
        maxItems: MAX_ACTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["PLACE_BLOCK","PLACE_WEDGE","PLACE_CYLINDER"] },
            pos:  { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            size: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            yaw:  { type: "number" },
            color:{ type: "string" },         // "#RRGGBB" veya "white", "beige"...
            material: { type: "string" },     // "concrete","wood","glass","smoothplastic","brick"...
            group:   { type: "string" }       // gruplayıp Model altında toplamak için
          },
          required: ["type","pos","size"]
        }
      }
    },
    required: ["actions"]
  },
  strict: true
};

function sysPrompt() {
  return [
    "You are a ROBLOX level designer that outputs ONLY JSON matching the given schema.",
    "Rules:",
    "- Units are ROBLOX studs.",
    "- Place everything RELATIVE to origin [0,0,0]. The game will offset to the player's aim.",
    "- Keep sizes reasonable (0.1..200). Use integer-ish values when possible.",
    "- Prefer simple blocks for walls/floors/roof; wedges for sloped roofs; cylinders for pillars.",
    "- Group related parts with a short group name, e.g., 'house', 'roof', 'windows'.",
    "- Never include prose; only JSON per schema."
  ].join("\n");
}

async function chatJSON(prompt: string) {
  const apiKey = (process.env as any).OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, body: { actions: [], reason: "NO_KEY" } };
  }

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: sysPrompt() },
      { role: "user",   content: prompt }
    ],
    temperature: 0.2,
    // OpenAI Structured Outputs (JSON Schema)
    response_format: {
      type: "json_schema",
      json_schema: schema
    }
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch {}

  if (!r.ok) {
    return { ok: false, status: r.status, body: { actions: [], reason: "OPENAI_FAIL", detail: txt } };
  }

  const content = j?.choices?.[0]?.message?.content ?? "";
  let data: any = null; try { data = JSON.parse(content); } catch {}
  if (!data || !Array.isArray(data.actions)) {
    return { ok: false, status: 200, body: { actions: [], reason: "BAD_MODEL_JSON", detail: content } };
  }

  // Güvenlik: makul sayı ve değerler
  data.actions = data.actions.slice(0, MAX_ACTIONS);
  return { ok: true, status: 200, body: data };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).OPENAI_API_KEY);
    return new Response(JSON.stringify({ ok: true, env: { OPENAI_API_KEY: hasKey }, version: "v11.0", runtime: "edge" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 300).trim();
    if (!prompt) {
      return new Response(JSON.stringify({ actions: [], reason: "EMPTY" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const { ok, status, body } = await chatJSON(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ actions: [], reason: "exception", detail: String(e?.stack || e) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};
