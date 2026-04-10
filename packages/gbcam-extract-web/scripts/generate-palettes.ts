import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RawPaletteEntry {
  name: string;
  colors: [string, string, string, string];
  buttonCombo?: string;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }

  return rows;
}

function generatePaletteModule() {
  const contentDir = path.join(
    __dirname,
    "../../../supporting-materials/color-tables",
  );

  // Read CSVs
  const mainCsv = fs.readFileSync(
    path.join(contentDir, "game-boy-camera-palettes.csv"),
    "utf-8",
  );
  const additionalCsv = fs.readFileSync(
    path.join(contentDir, "game-boy-color-additional-palettes.csv"),
    "utf-8",
  );
  const funCsv = fs.readFileSync(
    path.join(contentDir, "game-boy-color-fun-palettes.csv"),
    "utf-8",
  );

  // Parse CSVs
  const mainEntries = parseCSV(mainCsv);
  const additionalEntries = parseCSV(additionalCsv);
  const funEntries = parseCSV(funCsv);

  // Generate main palettes
  const mainPalettes: RawPaletteEntry[] = mainEntries.map((row) => ({
    name: `${row["Table Entry"]} ${row["Button Combo"] ? `(${row["Button Combo"]})` : ""}`.trim(),
    colors: [
      row["BG Color 0x00"],
      row["BG Color 0x01"],
      row["BG Color 0x02"],
      row["BG Color 0x03"],
    ] as [string, string, string, string],
    buttonCombo: row["Button Combo"] || undefined,
  }));

  // Generate additional palettes
  const additionalPalettes: RawPaletteEntry[] = additionalEntries.map(
    (row) => ({
      name: `${row["Layer"]} ${row["Table Entry"]}`,
      colors: [
        row["Color 0x00"],
        row["Color 0x01"],
        row["Color 0x02"],
        row["Color 0x03"],
      ] as [string, string, string, string],
    }),
  );

  // Generate fun palettes
  const funPalettes: RawPaletteEntry[] = funEntries.map((row) => ({
    name: row["Name"],
    colors: [
      row["Color 0x00"],
      row["Color 0x01"],
      row["Color 0x02"],
      row["Color 0x03"],
    ] as [string, string, string, string],
  }));

  // Generate TypeScript file
  const output = `// GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from CSV files in supporting-materials/color-tables/
// Run: cd packages/gbcam-extract-web && pnpm generate:palettes

export interface PaletteEntry {
  name: string;
  colors: [string, string, string, string];
  buttonCombo?: string;
}

export const MAIN_PALETTES: PaletteEntry[] = ${JSON.stringify(mainPalettes, null, 2)};

export const ADDITIONAL_PALETTES: PaletteEntry[] = ${JSON.stringify(additionalPalettes, null, 2)};

export const FUN_PALETTES: PaletteEntry[] = ${JSON.stringify(funPalettes, null, 2)};
`;

  const outputPath = path.join(__dirname, "../src/data/palettes-generated.ts");
  fs.writeFileSync(outputPath, output);
  console.log(`Generated ${outputPath}`);
}

generatePaletteModule();
