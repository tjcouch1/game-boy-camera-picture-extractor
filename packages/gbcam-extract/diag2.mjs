import sharp from "sharp";
const ref = (await sharp(`C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-input/park-output-corrected.png`).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
const res = (await sharp(`C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-output/park-1/park-1_gbcam.png`).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
const sam = (await sharp(`C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-output/park-1/debug/park-1_sample.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const snap = (v) => { const opts=[0,82,165,255]; let b=0,bd=1e9; for (const o of opts) { const d=Math.abs(v-o); if (d<bd) {bd=d; b=o;} } return b; };
console.log("park-1 errors:");
for (let y = 0; y < 112; y++) {
  for (let x = 0; x < 128; x++) {
    const r = snap(res[y*128+x]); const f = snap(ref[y*128+x]);
    if (r !== f) { const i = (y*128+x)*4; console.log(`(${x},${y}) R=${sam[i]} G=${sam[i+1]} B=${sam[i+2]} res=${r} ref=${f}`); }
  }
}
