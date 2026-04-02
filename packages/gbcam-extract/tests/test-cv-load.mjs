// Direct test of opencv-js loading in Node
import cvFactory from "@techstark/opencv-js";

console.log("cvFactory type:", typeof cvFactory);
console.log("cvFactory.then?:", typeof cvFactory.then);

// It's likely a Module factory or a thenable
if (typeof cvFactory === "function") {
  console.log("It's a function, calling it...");
  const cv = cvFactory();
  console.log("cv type:", typeof cv);
  console.log("cv.then?:", typeof cv.then);
  if (cv.then) {
    cv.then(ready => {
      console.log("Ready! Mat:", typeof ready.Mat);
      process.exit(0);
    });
  }
} else if (cvFactory && typeof cvFactory.then === "function") {
  console.log("It's a thenable, awaiting...");
  const cv = await cvFactory;
  console.log("Ready! Mat:", typeof cv.Mat);
  process.exit(0);
} else if (cvFactory && typeof cvFactory.Mat === "function") {
  console.log("Already loaded! Mat:", typeof cvFactory.Mat);
  process.exit(0);
} else {
  console.log("Unknown format. Keys:", Object.keys(cvFactory || {}).slice(0, 20));
  // Try treating it as a ready module
  console.log("onRuntimeInitialized?:", typeof cvFactory?.onRuntimeInitialized);
  process.exit(1);
}

setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 15000);
