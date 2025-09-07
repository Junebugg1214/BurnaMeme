import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const ROOT = "assets/memes";
const PRESETS = [
  { key: "x", w: 1600, h: 900 },
  { key: "linkedin", w: 1200, h: 627 },
  { key: "instagram", w: 1080, h: 1080 }
] as const;

const EXPORT_MODE = (process.env.EXPORT_MODE as "cover"|"contain"|"blurcontain") ?? "blurcontain";
const EXPORT_BG_HEX = (process.env.EXPORT_BG_HEX ?? "#0A0F1C").trim();

const LOGO_PATH = process.env.BURNA_LOGO_PATH || "./branding/burnaai_logo.png";
const WM_TEXT = process.env.BURNA_WATERMARK_TEXT || "BurnaAI";
const WM_HEX = (process.env.BURNA_WATERMARK_HEX || "#FFFFFF").trim();
const WM_OPACITY = Number(process.env.BURNA_WM_OPACITY ?? "0.7");
const WM_FONT_SIZE = Number(process.env.BURNA_WM_FONT_SIZE ?? "42");
const WM_MARGIN = Number(process.env.BURNA_WM_MARGIN ?? "28");
const LOGO_MAX_PCT = Math.min(0.4, Math.max(0.05, Number(process.env.BURNA_LOGO_MAX_WIDTH_PCT ?? "0.16")));

function hexToRgba(hex: string, alpha = 1) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255, alpha };
}

function wmSvg(W: number, H: number) {
  const x = Math.max(0, W - WM_MARGIN);
  const y = Math.max(0, H - WM_MARGIN);
  const svg = `
<svg width="${W}" height="${H}">
  <style>
    .wm { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; font-size:${WM_FONT_SIZE}px; fill:${WM_HEX}; opacity:${WM_OPACITY}; }
  </style>
  <text x="${x}" y="${y}" text-anchor="end" class="wm">${WM_TEXT}</text>
</svg>`;
  return Buffer.from(svg);
}

async function prepLogoForW(W: number) {
  try {
    const input = sharp(LOGO_PATH);
    const meta = await input.metadata();
    const targetW = Math.max(1, Math.round(W * LOGO_MAX_PCT));
    const ratio = meta.width && meta.width > 0 ? targetW / meta.width : 1;
    const targetH = meta.height && meta.height > 0 ? Math.max(1, Math.round(meta.height * ratio)) : targetW;
    const buf = await input.resize({ width: targetW, height: targetH, fit: "inside" }).png().toBuffer();
    return { buf, w: targetW, h: targetH };
  } catch {
    return null;
  }
}

async function newestRunDir(): Promise<string> {
  const dirs = await fs.readdir(ROOT, { withFileTypes: true });
  const names = dirs.filter(d => d.isDirectory()).map(d => d.name).sort();
  if (!names.length) throw new Error("No runs in assets/memes");
  return path.join(ROOT, names[names.length - 1]);
}

async function exportOne(masterPng: Buffer, outDir: string, baseSlug: string) {
  for (const p of PRESETS) {
    let base: sharp.Sharp;

    if (EXPORT_MODE === "cover") {
      base = sharp(masterPng).ensureAlpha().resize(p.w, p.h, { fit: "cover", position: "centre" });
    } else if (EXPORT_MODE === "contain") {
      base = sharp(masterPng).ensureAlpha().resize(p.w, p.h, { fit: "contain", background: hexToRgba(EXPORT_BG_HEX, 1) });
    } else {
      const bg = await sharp(masterPng).ensureAlpha().resize(p.w, p.h, { fit: "cover", position: "centre" })
        .blur(30).modulate({ saturation: 0.9, brightness: 0.95 }).toBuffer();
      const fg = await sharp(masterPng).ensureAlpha().resize(p.w, p.h, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 } }).toBuffer();
      base = sharp(bg).composite([{ input: fg, gravity: "centre" }]);
    }

    const meta = await base.metadata();
    const W = meta.width ?? p.w;
    const H = meta.height ?? p.h;
    const logo = await prepLogoForW(W);

    const overlays: sharp.OverlayOptions[] = [];
    if (logo) overlays.push({ input: logo.buf, left: Math.max(0, W - logo.w - WM_MARGIN), top: Math.max(0, H - logo.h - WM_MARGIN) });
    overlays.push({ input: wmSvg(W, H) });

    const composed = await base.composite(overlays);

    const platDir = path.join(outDir, p.key);
    await fs.mkdir(platDir, { recursive: true });
    const outPath = path.join(platDir, `${baseSlug}_${p.key}.png`);
    await composed.png().toFile(outPath);
    console.log(`Reframed → ${outPath}`);
  }
}

(async () => {
  const runDir = await newestRunDir();                 // assets/memes/YYYY-MM-DD
  const rawDir = path.join(runDir, "_raw");
  const files = (await fs.readdir(rawDir)).filter(f => f.endsWith("_master.png"));

  for (const f of files) {
    const fp = path.join(rawDir, f);
    const baseSlug = f.replace("_master.png", "");
    const png = await fs.readFile(fp);
    await exportOne(png, runDir, baseSlug);
  }
})();
