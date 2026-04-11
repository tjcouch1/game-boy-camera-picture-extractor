import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test the palette generation from CSV files
 * Tests that:
 * - CSV files are parsed correctly
 * - Palette data structure is valid
 * - Button combo extraction works
 * - Generated file contains valid TypeScript
 */

describe("generate-palettes", () => {
  let generatedContent: string;
  let colorTablesDir: string;

  beforeAll(() => {
    colorTablesDir = path.join(
      __dirname,
      "../../../supporting-materials/color-tables",
    );

    // Read the generated palettes file
    const generatedPath = path.join(
      __dirname,
      "../src/data/palettes-generated.ts",
    );
    generatedContent = fs.readFileSync(generatedPath, "utf-8");
  });

  it("should have valid TypeScript syntax with PaletteEntry interface", () => {
    expect(generatedContent).toContain("interface PaletteEntry");
    expect(generatedContent).toContain("name: string");
    expect(generatedContent).toContain(
      "colors: [string, string, string, string]",
    );
    expect(generatedContent).toContain("buttonCombo?: string");
  });

  it("should export MAIN_PALETTES array", () => {
    expect(generatedContent).toContain("export const MAIN_PALETTES");
    const match = generatedContent.match(/export const MAIN_PALETTES.*?\];/s);
    expect(match).toBeTruthy();
  });

  it("should export ADDITIONAL_PALETTES array", () => {
    expect(generatedContent).toContain("export const ADDITIONAL_PALETTES");
    const match = generatedContent.match(
      /export const ADDITIONAL_PALETTES.*?\];/s,
    );
    expect(match).toBeTruthy();
  });

  it("should export FUN_PALETTES array", () => {
    expect(generatedContent).toContain("export const FUN_PALETTES");
    const match = generatedContent.match(/export const FUN_PALETTES.*?\];/s);
    expect(match).toBeTruthy();
  });

  it("should have valid JSON structure for palettes", () => {
    // Extract JSON arrays and validate they're proper JSON
    const mainMatch = generatedContent.match(
      /MAIN_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    const additionalMatch = generatedContent.match(
      /ADDITIONAL_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    const funMatch = generatedContent.match(/FUN_PALETTES.*?= (\[[\s\S]*?\]);/);

    expect(mainMatch).toBeTruthy();
    expect(additionalMatch).toBeTruthy();
    expect(funMatch).toBeTruthy();

    if (mainMatch) {
      expect(() => JSON.parse(mainMatch[1])).not.toThrow();
    }
    if (additionalMatch) {
      expect(() => JSON.parse(additionalMatch[1])).not.toThrow();
    }
    if (funMatch) {
      expect(() => JSON.parse(funMatch[1])).not.toThrow();
    }
  });

  it("should parse palette colors in correct format", () => {
    // Check for hex color pattern in the file
    const hexColorPattern = /#[0-9A-F]{6}/gi;
    const colors = generatedContent.match(hexColorPattern) || [];

    expect(colors.length).toBeGreaterThan(0);
    colors.forEach((color) => {
      expect(color).toMatch(/#[0-9A-F]{6}/i);
    });
  });

  it("should have MAIN_PALETTES with correct structure", () => {
    const match = generatedContent.match(
      /export const MAIN_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    if (!match) {
      throw new Error("Could not find MAIN_PALETTES");
    }

    const palettes = JSON.parse(match[1]);
    expect(Array.isArray(palettes)).toBe(true);
    expect(palettes.length).toBeGreaterThan(0);

    // Check structure of first palette
    const firstPalette = palettes[0];
    expect(firstPalette).toHaveProperty("name");
    expect(firstPalette).toHaveProperty("colors");
    expect(Array.isArray(firstPalette.colors)).toBe(true);
    expect(firstPalette.colors.length).toBe(4);

    firstPalette.colors.forEach((color: string) => {
      expect(color).toMatch(/#[0-9A-F]{6}/i);
    });
  });

  it("should extract button combos from MAIN_PALETTES", () => {
    const match = generatedContent.match(
      /export const MAIN_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    if (!match) {
      throw new Error("Could not find MAIN_PALETTES");
    }

    const palettes = JSON.parse(match[1]);

    // At least some palettes should have buttonCombo
    const withCombo = palettes.filter(
      (p: { buttonCombo?: string }) => p.buttonCombo,
    );
    expect(withCombo.length).toBeGreaterThan(0);
  });

  it("should have unique palette names in each category", () => {
    const extractArray = (arrayName: string) => {
      const match = generatedContent.match(
        new RegExp(`export const ${arrayName}.*?= (\\[[\\s\\S]*?\\]);`),
      );
      if (!match) return [];
      return JSON.parse(match[1]);
    };

    const main = extractArray("MAIN_PALETTES");
    const additional = extractArray("ADDITIONAL_PALETTES");
    const fun = extractArray("FUN_PALETTES");

    // Check for duplicates within each category
    const checkUnique = (palettes: { name: string }[], category: string) => {
      const names = palettes.map((p) => p.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    };

    checkUnique(main, "MAIN_PALETTES");
    checkUnique(additional, "ADDITIONAL_PALETTES");
    checkUnique(fun, "FUN_PALETTES");
  });

  it("should have all CSV files present", () => {
    const files = [
      "game-boy-camera-palettes.csv",
      "game-boy-color-additional-palettes.csv",
      "game-boy-color-fun-palettes.csv",
    ];

    files.forEach((file) => {
      const filePath = path.join(colorTablesDir, file);
      expect(fs.existsSync(filePath)).toBe(true, `Missing CSV file: ${file}`);
    });
  });

  it("should have file header comment indicating generation", () => {
    expect(generatedContent).toContain("GENERATED FILE");
    expect(generatedContent).toContain("DO NOT EDIT MANUALLY");
    expect(generatedContent).toContain("supporting-materials/color-tables/");
  });

  it("should have ADDITIONAL_PALETTES with correct structure", () => {
    const match = generatedContent.match(
      /export const ADDITIONAL_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    if (!match) {
      throw new Error("Could not find ADDITIONAL_PALETTES");
    }

    const palettes = JSON.parse(match[1]);
    expect(Array.isArray(palettes)).toBe(true);

    if (palettes.length > 0) {
      const firstPalette = palettes[0];
      expect(firstPalette).toHaveProperty("name");
      expect(firstPalette).toHaveProperty("colors");
      expect(firstPalette.colors.length).toBe(4);
    }
  });

  it("should have FUN_PALETTES with correct structure", () => {
    const match = generatedContent.match(
      /export const FUN_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    if (!match) {
      throw new Error("Could not find FUN_PALETTES");
    }

    const palettes = JSON.parse(match[1]);
    expect(Array.isArray(palettes)).toBe(true);

    if (palettes.length > 0) {
      const firstPalette = palettes[0];
      expect(firstPalette).toHaveProperty("name");
      expect(firstPalette).toHaveProperty("colors");
      expect(firstPalette.colors.length).toBe(4);
      expect(firstPalette.buttonCombo).toBeUndefined();
    }
  });

  it("should not have buttonCombo in ADDITIONAL_PALETTES or FUN_PALETTES", () => {
    const extractArray = (arrayName: string) => {
      const match = generatedContent.match(
        new RegExp(`export const ${arrayName}.*?= (\\[[\\s\\S]*?\\]);`),
      );
      if (!match) return [];
      return JSON.parse(match[1]);
    };

    const additional = extractArray("ADDITIONAL_PALETTES");
    const fun = extractArray("FUN_PALETTES");

    additional.forEach((p: { buttonCombo?: string }) => {
      expect(p.buttonCombo).toBeUndefined();
    });

    fun.forEach((p: { buttonCombo?: string }) => {
      expect(p.buttonCombo).toBeUndefined();
    });
  });

  it("should parse palette names correctly from CSV", () => {
    const match = generatedContent.match(
      /export const MAIN_PALETTES.*?= (\[[\s\S]*?\]);/,
    );
    if (!match) {
      throw new Error("Could not find MAIN_PALETTES");
    }

    const palettes = JSON.parse(match[1]);

    // Check that names follow expected pattern (e.g., "0x00", "0x01", etc)
    const hexPattern = /^0x[0-9A-F]{2}$/i;
    const hasHexNames = palettes.some((p: { name: string }) =>
      hexPattern.test(p.name),
    );
    expect(hasHexNames).toBe(true);
  });
});
