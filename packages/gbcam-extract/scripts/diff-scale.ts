import sharp from "sharp";
import { execSync } from "child_process";
import { mkdirSync } from "fs";

const REPO_ROOT = "../..";
const PALETTE = { 0: "BK", 82: "DG", 165: "LG", 255: "WH" } as const;

async function loadPNG(buf: Buffer): Promise<{ data: Uint8Array; w: number; h: number; ch: number }> {
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), w: meta.width!, h: meta.height!, ch: info.channels };
}

const OUT_DIR = "C:/tmp/scale-diff";
const SCALE = 8; // upscale for visual

function renderPanel(
  out: Buffer,
  outW: number,
  src: { data: Uint8Array; w: number; h: number; ch: number },
  xOff: number,
  yOff: number,
  isDiff: ((x: number, y: number) => boolean) | null,
  mode: "image" | "diff-only" | "image-with-diff",
) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = src.data[(y * src.w + x) * src.ch];
      const diff = isDiff?.(x, y) ?? false;
      let r: number, g: number, b: number;
      if (mode === "diff-only") {
        if (diff) { r = 255; g = 0; b = 0; }
        else { r = 32; g = 32; b = 32; }
      } else if (mode === "image-with-diff") {
        if (diff) { r = 255; g = 0; b = 0; }
        else { r = v; g = v; b = v; }
      } else {
        r = v; g = v; b = v;
      }
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const idx = ((yOff + y * SCALE + dy) * outW + (xOff + x * SCALE + dx)) * 3;
          out[idx] = r; out[idx + 1] = g; out[idx + 2] = b;
        }
      }
    }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const stem of ["20260313_213443", "20260328_165926"]) {
    const path = `sample-pictures-out/${stem}_gbcam.png`;
    const oldBuf = execSync(`git -C ${REPO_ROOT} show HEAD~2:${path}`, { stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 24 });
    const newBuf = execSync(`git -C ${REPO_ROOT} show HEAD:${path}`, { stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 24 });

    const oldImg = await loadPNG(oldBuf);
    const newImg = await loadPNG(newBuf);
    const w = oldImg.w, h = oldImg.h;

    const isDiff = (x: number, y: number): boolean => {
      const i = (y * w + x) * oldImg.ch;
      return oldImg.data[i] !== newImg.data[i];
    };

    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isDiff(x, y)) count++;
    console.log(`${stem}: ${count} pixels differ (${(count / (w * h) * 100).toFixed(2)}%)`);

    // 3-panel: old | new | diff-only, separated by 4-px gutters
    const gutter = 4 * SCALE;
    const panelW = w * SCALE;
    const panelH = h * SCALE;
    const totalW = panelW * 3 + gutter * 2;
    const totalH = panelH;
    const out = Buffer.alloc(totalW * totalH * 3, 96); // mid-grey gutter

    renderPanel(out, totalW, oldImg, 0, 0, null, "image");
    renderPanel(out, totalW, newImg, panelW + gutter, 0, null, "image");
    renderPanel(out, totalW, oldImg, panelW * 2 + gutter * 2, 0, isDiff, "diff-only");

    const outPath = `${OUT_DIR}/${stem}_3panel.png`;
    await sharp(out, { raw: { width: totalW, height: totalH, channels: 3 } })
      .png()
      .toFile(outPath);
    console.log(`  → ${outPath}  (old | new | diff)`);

    // Also: image-with-diff overlay (each version with red dots showing the changed pixels)
    const overlayW = panelW * 2 + gutter;
    const overlay = Buffer.alloc(overlayW * panelH * 3, 96);
    renderPanel(overlay, overlayW, oldImg, 0, 0, isDiff, "image-with-diff");
    renderPanel(overlay, overlayW, newImg, panelW + gutter, 0, isDiff, "image-with-diff");
    const overlayPath = `${OUT_DIR}/${stem}_overlay.png`;
    await sharp(overlay, { raw: { width: overlayW, height: panelH, channels: 3 } })
      .png()
      .toFile(overlayPath);
    console.log(`  → ${overlayPath}  (old + diff | new + diff)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
