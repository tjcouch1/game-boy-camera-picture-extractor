import {
  MAIN_PALETTES,
  ADDITIONAL_PALETTES as ADDITIONAL_FROM_CSV,
  FUN_PALETTES,
  type PaletteEntry,
} from "gbcam-extract";

export type { PaletteEntry } from "gbcam-extract";

// Filter main palettes by button combo for BUTTON_COMBO_PALETTES section
export const BUTTON_COMBO_PALETTES: PaletteEntry[] = MAIN_PALETTES.filter(
  (p) => p.buttonCombo,
).map((p) => ({
  name: p.buttonCombo!,
  colors: p.colors,
}));

// All main BG palettes
export const BG_PRESETS: PaletteEntry[] = MAIN_PALETTES.map((p) => {
  // Use entry ID or button combo as name
  const name = p.name.split("(")[0].trim();
  return {
    name,
    colors: p.colors,
  };
});

// Additional palettes from CSV
export const ADDITIONAL_PALETTES: PaletteEntry[] = ADDITIONAL_FROM_CSV.map(
  (p) => ({
    name: p.name,
    colors: p.colors,
  }),
);

// Fun/novelty palettes from CSV
export const FUN_PALETTES_EXPORT: PaletteEntry[] = FUN_PALETTES.map((p) => ({
  name: p.name,
  colors: p.colors,
}));

export const ALL_PALETTES = [
  ...BUTTON_COMBO_PALETTES,
  ...BG_PRESETS,
  ...ADDITIONAL_PALETTES,
  ...FUN_PALETTES_EXPORT,
];
