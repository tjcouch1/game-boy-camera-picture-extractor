#!/usr/bin/env node

/**
 * Generate license file for all dependencies using license-checker
 * Transforms the license data into a beautiful HTML page
 * This script runs on postinstall to keep licenses up-to-date
 */

import * as licenseChecker from "license-checker";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageDir = path.join(__dirname, "..");
const publicDir = path.join(packageDir, "public");
const configPath = path.join(packageDir, "license-checker.config.json");
const outputFile = path.join(publicDir, "licenses.html");

interface LicenseInfo {
  licenses: string;
  repository?: string;
  licenseFile: string;
  licenseText: string;
  [key: string]: any;
}

interface LicenseData {
  [packageName: string]: LicenseInfo;
}

// Extract copyright from license text (look for common patterns)
function extractCopyright(licenseText: string): string {
  const lines = licenseText.split("\n");
  for (const line of lines) {
    if (line.toLowerCase().includes("copyright")) {
      return line.trim();
    }
  }
  return "";
}

// Transform license data into HTML format
function generateHtmlLicensesPage(licenses: LicenseData): string {
  // Convert to array and sort by package name
  const licenseArray = Object.entries(licenses)
    .map(([name, info]) => ({
      name,
      ...info,
      copyright: extractCopyright(info.licenseText),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const licenseList = licenseArray
    .map((license) => {
      const licenseText = license.licenseText || "License text not available";
      const escaped = licenseText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      return `
    <div class="license-entry">
      <h3>${license.name}</h3>
      <p class="license-type">${license.licenses || "Unknown"}</p>
      ${license.copyright ? `<p class="copyright">${license.copyright}</p>` : ""}
      ${license.repository ? `<p class="repository"><a href="${license.repository}" target="_blank" rel="noopener noreferrer">${license.repository}</a></p>` : ""}
      <details>
        <summary>View License Text</summary>
        <pre><code>${escaped}</code></pre>
      </details>
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Open Source Licenses - Game Boy Camera Picture Extractor</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
        sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background-color: #111827;
      color: #f3f4f6;
      line-height: 1.6;
    }

    .container {
      max-width: 48rem;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid #374151;
      padding-bottom: 2rem;
    }

    h1 {
      font-size: 2rem;
      font-weight: bold;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    h1 img {
      width: 2rem;
      height: 2rem;
    }

    p {
      color: #d1d5db;
      margin-bottom: 1rem;
    }

    a {
      color: #60a5fa;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 1rem;
      padding: 0.5rem 1rem;
      background-color: #1f2937;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      color: #9ca3af;
      text-decoration: none;
      transition: all 0.2s;
    }

    .back-link:hover {
      background-color: #374151;
      color: #f3f4f6;
      text-decoration: none;
    }

    .license-entry {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background-color: #1f2937;
      border: 1px solid #374151;
      border-radius: 0.5rem;
    }

    .license-entry h3 {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .license-type {
      font-size: 0.875rem;
      color: #9ca3af;
      margin-bottom: 0.5rem;
    }

    .copyright {
      font-size: 0.875rem;
      color: #9ca3af;
      margin-bottom: 0.5rem;
      font-style: italic;
    }

    .repository {
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .repository a {
      word-break: break-all;
    }

    details {
      margin-top: 1rem;
    }

    summary {
      cursor: pointer;
      padding: 0.5rem;
      margin: -0.5rem;
      border-radius: 0.25rem;
      user-select: none;
      color: #60a5fa;
      transition: all 0.2s;
    }

    summary:hover {
      background-color: #111827;
    }

    pre {
      margin-top: 0.75rem;
      padding: 1rem;
      background-color: #111827;
      border-radius: 0.375rem;
      overflow-x: auto;
      font-size: 0.75rem;
      line-height: 1.5;
      max-height: 400px;
    }

    code {
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo',
        'Courier', monospace;
      color: #d1d5db;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    footer {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #374151;
      text-align: center;
      font-size: 0.875rem;
      color: #6b7280;
    }

    @media (prefers-color-scheme: light) {
      body {
        background-color: #f9fafb;
        color: #111827;
      }

      .container {
        color: #111827;
      }

      p {
        color: #4b5563;
      }

      header {
        border-bottom-color: #e5e7eb;
      }

      .back-link {
        background-color: #f3f4f6;
        color: #6b7280;
      }

      .back-link:hover {
        background-color: #e5e7eb;
        color: #111827;
      }

      .license-entry {
        background-color: #f3f4f6;
        border-color: #e5e7eb;
      }

      summary:hover {
        background-color: #f9fafb;
      }

      pre {
        background-color: #f9fafb;
      }

      code {
        color: #4b5563;
      }

      footer {
        border-top-color: #e5e7eb;
        color: #9ca3af;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to App</a>

    <header>
      <h1>
        <img src="./icon.svg" alt="">
        Open Source Licenses
      </h1>
      <p>
        This application uses the following open source dependencies. Thank you to all the maintainers!
      </p>
    </header>

    <main>
      ${licenseList}
    </main>

    <footer>
      <p>Generated from package dependencies. Last updated on ${new Date().toLocaleString()}</p>
    </footer>
  </div>
</body>
</html>`;
}

async function main() {
  try {
    // Ensure public directory exists
    await fs.mkdir(publicDir, { recursive: true });

    // Use license-checker to get all licenses
    console.log("Resolving licenses...");

    const licenseData = await new Promise<LicenseData>((resolve, reject) => {
      licenseChecker.init(
        {
          start: packageDir,
          customPath: configPath,
          json: true,
        },
        (err, packages) => {
          if (err) {
            reject(err);
          } else {
            resolve(packages as LicenseData);
          }
        },
      );
    });

    // Generate HTML from license data
    const htmlContent = generateHtmlLicensesPage(licenseData);

    // Write to file
    await fs.writeFile(outputFile, htmlContent, "utf-8");

    console.log(`✓ Generated licenses page at ${outputFile}`);
  } catch (error) {
    console.error(
      "Error generating licenses:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main();
