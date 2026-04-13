/**
 * Utility functions for copying and pasting palettes to/from clipboard.
 */

export interface SerializedPalette {
  name: string;
  colors: [string, string, string, string];
}

/**
 * Serialize a palette to a JSON string for clipboard storage.
 * Format: JSON string with name and colors array
 */
export function serializePaletteToClipboard(
  palette: SerializedPalette,
): string {
  return JSON.stringify({
    type: "gbcam-palette",
    version: "1",
    data: palette,
  });
}

/**
 * Deserialize a palette from clipboard contents.
 * Validates format and returns the palette, or null if invalid.
 */
export function deserializePaletteFromClipboard(
  text: string,
): SerializedPalette | null {
  try {
    const parsed = JSON.parse(text);

    // Check for our format
    if (parsed.type === "gbcam-palette" && parsed.version === "1") {
      const data = parsed.data;
      if (
        data &&
        typeof data === "object" &&
        typeof data.name === "string" &&
        Array.isArray(data.colors) &&
        data.colors.length === 4 &&
        data.colors.every(
          (c: unknown) => typeof c === "string" && /^#[0-9A-F]{6}$/i.test(c),
        )
      ) {
        return data as SerializedPalette;
      }
    }
  } catch {
    // Invalid JSON or parse error - not a palette
  }

  return null;
}

/**
 * Check if clipboard contents are formatted as a palette.
 * This is async because we need to read from the clipboard API.
 */
export async function isPaletteInClipboard(): Promise<boolean> {
  try {
    // Check if clipboard API is available
    if (!navigator.clipboard) {
      return false;
    }
    const text = await navigator.clipboard.readText();
    return deserializePaletteFromClipboard(text) !== null;
  } catch {
    // Clipboard API not available or denied
    return false;
  }
}

/**
 * Read a palette from the clipboard.
 */
export async function readPaletteFromClipboard(): Promise<SerializedPalette | null> {
  try {
    // Check if clipboard API is available
    if (!navigator.clipboard) {
      return null;
    }
    const text = await navigator.clipboard.readText();
    return deserializePaletteFromClipboard(text);
  } catch {
    // Clipboard API not available or denied
    return null;
  }
}

/**
 * Write a palette to the clipboard.
 */
export async function writePaletteToClipboard(
  palette: SerializedPalette,
): Promise<boolean> {
  try {
    const serialized = serializePaletteToClipboard(palette);
    await navigator.clipboard.writeText(serialized);
    return true;
  } catch {
    // Clipboard API not available or denied
    return false;
  }
}
