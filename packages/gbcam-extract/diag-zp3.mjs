import sharp from "sharp";
const tests = ["zelda-poster-3", "zelda-poster-2", "zelda-poster-1", "thing-3"];
for (const name of tests) {
  const refBase = name.startsWith("zelda") ? "zelda-poster" : "thing";
  const refPath = `C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-input/${refBase}-output-corrected.png`;
  const resPath = `C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-output/${name}/${name}_gbcam.png`;
  const samPath = `C:/Users/tj_co/source/repos-p/game-boy-camera-picture-extractor-2/test-output/${name}/debug/${name}_sample.png`;
  const ref = (await sharp(refPath).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
  const res = (await sharp(resPath).greyscale().raw().toBuffer({ resolveWithObject: true })).data;
  const sam = (await sharp(samPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  const snap = (v) => { const opts=[0,82,165,255]; let b=0,bd=1e9; for (const o of opts) { const d=Math.abs(v-o); if (d<bd) {bd=d; b=o;} } return b; };
  console.log(`\n=== ${name} ===`);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 128; x++) {
      const r = snap(res[y * 128 + x]);
      const f = snap(ref[y * 128 + x]);
      if (r !== f) {
        const sIdx = (y * 128 + x) * 4;
        console.log(`(${x},${y}) R=${sam[sIdx]} G=${sam[sIdx+1]} B=${sam[sIdx+2]} result=${r} ref=${f}`);
      }
    }
  }
}
