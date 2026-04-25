import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, "..");
const distDir = path.join(webDir, "dist");

async function main() {
  // Check if dist exists
  if (!existsSync(distDir)) {
    console.log("🔨 Building website...");
    const buildResult = await new Promise<number>((resolve) => {
      const build = spawn("pnpm", ["build"], {
        cwd: webDir,
        stdio: "inherit",
      });
      build.on("close", (code) => {
        resolve(code || 0);
      });
    });

    if (buildResult !== 0) {
      console.error("Build failed");
      process.exit(1);
    }
  }

  console.log("🚀 Starting local server...");
  console.log(`📂 Serving from: ${distDir}`);

  // Use npx http-server (lightweight, no extra deps needed if already installed)
  // Fallback: use Node.js built-in http module
  const server = spawn("npx", ["http-server", distDir, "-p", "3000", "-c-1"], {
    stdio: "inherit",
  });

  console.log("🌐 Open http://localhost:3000 in your browser");
  console.log("Press Ctrl+C to stop the server");

  server.on("close", (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
