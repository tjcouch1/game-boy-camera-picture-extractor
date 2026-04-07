#!/usr/bin/env node
/**
 * Test script to verify that initOpenCV works correctly in Node.js.
 *
 * This test imports the initOpenCV function, calls it to initialize
 * OpenCV, and then checks that the cv object has the expected
 * properties and can create a Mat.
 *
 * Run with: pnpm run test:opencv-init-node
 */

import { getCV, initOpenCV } from "./src/opencv.js";

async function main() {
  console.log("Starting OpenCV initialization test...\n");

  try {
    // Test 1: Test direct CommonJS require of @techstark/opencv-js
    console.log("1. Testing initOpenCV to load @techstark/opencv-js...");
    const startReq = Date.now();

    // const cvModule = require("@techstark/opencv-js");
    await initOpenCV(); // This will internally require the module and initialize it
    const cv = getCV(); // Get the initialized cv module

    const reqTime = Date.now() - startReq;
    console.log(`   Module loaded in ${reqTime}ms`);

    // Test 2: Verify OpenCV has required properties
    console.log("2. Verifying OpenCV module has required properties...");
    const requiredProps = [
      "Mat",
      "kmeans",
      "TermCriteria",
      "CV_8UC4",
      "CV_32F",
    ];
    const missingProps = requiredProps.filter((prop) => !(prop in cv));

    if (missingProps.length > 0) {
      throw new Error(`Missing OpenCV properties: ${missingProps.join(", ")}`);
    }
    console.log(
      `   ✓ All required properties present: ${requiredProps.join(", ")}\n`,
    );

    // Test 3: Create a test Mat
    console.log("3. Creating and using a test Mat...");
    const testMat = new cv.Mat(10, 10, cv.CV_8UC4);
    if (!testMat.data) {
      throw new Error("Mat created but data is not available");
    }
    console.log(`   ✓ Created 10x10 Mat with data accessor`);
    testMat.delete();
    console.log(`   ✓ Mat deleted successfully\n`);

    // Test 4: Test TermCriteria
    console.log("4. Testing TermCriteria...");
    const criteria = new cv.TermCriteria(
      cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
      300,
      1.0,
    );
    console.log(`   ✓ TermCriteria created successfully\n`);

    console.log("✅ All tests passed!\n");
    console.log("Summary:");
    console.log(`  - initOpenCV: ${reqTime}ms`);
    console.log("\n✓ OpenCV is ready to use in Node.js with initOpenCV()");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed with error:");
    console.error(err.message || err);
    if (err.stack) {
      console.error("\nStack trace:");
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
