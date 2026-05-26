/**
 * extract-ground-truth.ts — extracts red/green points from hand-edited images.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
const CANON_TOP = 120;
const CANON_BOT = 1031;
const CANON_LEFT = 120;
const CANON_RIGHT = 1159;

interface Point { x: number; y: number; offX?: number; offY?: number }
interface GroundTruth {
  file: string;
  corners: Point[];
  top: Point[];
  bot: Point[];
  left: Point[];
  right: Point[];
}

async function processImage(filePath: string): Promise<GroundTruth> {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const gt: GroundTruth = {
    file: path.basename(filePath),
    corners: [],
    top: [],
    bot: [],
    left: [],
    right: []
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Green #00FF00 = Corners
      if (r === 0 && g === 255 && b === 0) {
        let offX = 0, offY = 0;
        if (x < width / 2) offX = x - CANON_LEFT; else offX = x - CANON_RIGHT;
        if (y < height / 2) offY = y - CANON_TOP; else offY = y - CANON_BOT;
        gt.corners.push({ x, y, offX, offY });
      }
      // Red #FF0000 = Border points
      else if (r === 255 && g === 0 && b === 0) {
        // Categorize by side using simple quadrant/proximity logic
        if (y < 200) {
           gt.top.push({ x, y, offY: y - CANON_TOP });
        } else if (y > 950) {
           gt.bot.push({ x, y, offY: y - CANON_BOT });
        } else if (x < 200) {
           gt.left.push({ x, y, offX: x - CANON_LEFT });
        } else if (x > 1000) {
           gt.right.push({ x, y, offX: x - CANON_RIGHT });
        }
      }
    }
  }

  // Sort points to make them readable
  gt.top.sort((a, b) => a.x - b.x);
  gt.bot.sort((a, b) => a.x - b.x);
  gt.left.sort((a, b) => a.y - b.y);
  gt.right.sort((a, b) => a.y - b.y);

  return gt;
}

async function main() {
  const dir = "../../warp-hand-edited-points-branch-warp-and-diagnostics-subagent-plan-2026-05-23";
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".png"));
  const results: GroundTruth[] = [];

  for (const f of files) {
    console.log(`Processing ${f}...`);
    results.push(await processImage(path.join(dir, f)));
  }

  const output = {
    metadata: {
      canonical: {
        topY: CANON_TOP,
        bottomY: CANON_BOT,
        leftX: CANON_LEFT,
        rightX: CANON_RIGHT
      },
      note: "Red/Green points indicate the perceived outer edge of the DG strip. Offsets are (actual - canonical)."
    },
    images: results
  };

  await fs.writeFile(path.join(dir, "ground-truth.json"), JSON.stringify(output, null, 2));
  console.log("Saved ground-truth.json");
}

main();
