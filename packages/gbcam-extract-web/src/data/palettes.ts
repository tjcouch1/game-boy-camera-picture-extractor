export interface PaletteEntry {
  name: string;
  colors: [string, string, string, string];
}

// Button combo presets — well-known Game Boy palettes
export const BUTTON_COMBO_PALETTES: PaletteEntry[] = [
  { name: "Right", colors: ["#FFFFFF", "#52FF00", "#FF4200", "#000000"] },
  { name: "A+Down", colors: ["#FFFFFF", "#FFFF00", "#FF0000", "#000000"] },
  { name: "A+Left", colors: ["#FFFFFF", "#8C8CDE", "#52528C", "#000000"] },
  { name: "A+Up", colors: ["#FFFFFF", "#FF8484", "#943A3A", "#000000"] },
  { name: "Up", colors: ["#FFFFFF", "#FFAD63", "#843100", "#000000"] },
  { name: "B+Right", colors: ["#000000", "#008484", "#FFDE00", "#FFFFFF"] },
  { name: "B+Left", colors: ["#FFFFFF", "#A5A5A5", "#525252", "#000000"] },
  { name: "Down", colors: ["#FFFFA5", "#FF9494", "#9494FF", "#000000"] },
  { name: "Left", colors: ["#FFFFFF", "#63A5FF", "#0000FF", "#000000"] },
  { name: "B+Up", colors: ["#FFE6C5", "#CE9C84", "#846B29", "#5A3108"] },
  { name: "B+Down", colors: ["#FFFFFF", "#FFFF00", "#7B4A00", "#000000"] },
  { name: "A+Right", colors: ["#FFFFFF", "#7BFF31", "#0063C5", "#000000"] },
];

// BG presets (0x00-0x1B range, excluding ones covered by button combos above)
export const BG_PRESETS: PaletteEntry[] = [
  { name: "BG 0x00", colors: ["#FFFFFF", "#B6B6B6", "#676767", "#000000"] },
  { name: "BG 0x01", colors: ["#FFFFFF", "#FF9C00", "#FF0000", "#000000"] },
  { name: "BG 0x02", colors: ["#FFFFFF", "#FFCE00", "#9C6300", "#000000"] },
  { name: "BG 0x03", colors: ["#FFFFFF", "#ADFF2F", "#008C00", "#000000"] },
  { name: "BG 0x04", colors: ["#FFFFFF", "#8CFFDE", "#008484", "#000000"] },
  { name: "BG 0x05", colors: ["#FFFFFF", "#63ADFF", "#0000FF", "#000000"] },
  { name: "BG 0x06", colors: ["#FFFFFF", "#B5B5FF", "#6363AD", "#000000"] },
  { name: "BG 0x07", colors: ["#FFFFFF", "#FF8CAD", "#AD0052", "#000000"] },
  { name: "BG 0x08", colors: ["#FFE6C5", "#D6AD6B", "#8C6318", "#000000"] },
  { name: "BG 0x09", colors: ["#FFFFCE", "#FFCE00", "#9C6300", "#000000"] },
  { name: "BG 0x0A", colors: ["#E7FFCE", "#6BFF00", "#008C00", "#000000"] },
  { name: "BG 0x0B", colors: ["#CEFFFF", "#00FFFF", "#008484", "#000000"] },
  { name: "BG 0x0C", colors: ["#CEE7FF", "#6BB5FF", "#0000FF", "#000000"] },
  { name: "BG 0x0D", colors: ["#DECEFF", "#B584FF", "#6300CE", "#000000"] },
  { name: "BG 0x0E", colors: ["#FFCEFF", "#FF84FF", "#9C009C", "#000000"] },
  { name: "BG 0x0F", colors: ["#FFCECE", "#FF7373", "#AD0000", "#000000"] },
];

// Additional palettes (OBJ0/OBJ1 sprite palettes and other notable variants)
export const ADDITIONAL_PALETTES: PaletteEntry[] = [
  { name: "OBJ0 Classic", colors: ["#FFFFFF", "#FF8484", "#943A3A", "#000000"] },
  { name: "OBJ1 Classic", colors: ["#FFFFFF", "#63A5FF", "#0000FF", "#000000"] },
  { name: "DMG Green", colors: ["#9BBC0F", "#8BAC0F", "#306230", "#0F380F"] },
  { name: "Pocket", colors: ["#C4CFA1", "#8B956D", "#4D533C", "#1F1F1F"] },
  { name: "Light", colors: ["#00B581", "#009A71", "#00694A", "#004F3B"] },
  { name: "Kiosk", colors: ["#FFE600", "#E79200", "#A04900", "#4C1800"] },
  { name: "SGB 1A", colors: ["#F8E8C8", "#D89048", "#A82820", "#301850"] },
  { name: "SGB 2A", colors: ["#F8E8C8", "#E09850", "#A03020", "#402038"] },
  { name: "SGB 3A", colors: ["#F8D8B0", "#78C078", "#688840", "#583820"] },
  { name: "SGB 4A", colors: ["#F8E068", "#D8A038", "#A05010", "#000000"] },
  { name: "Grayscale", colors: ["#FFFFFF", "#AAAAAA", "#555555", "#000000"] },
  { name: "Inverted", colors: ["#000000", "#555555", "#AAAAAA", "#FFFFFF"] },
];

export const ALL_PALETTES = [
  ...BUTTON_COMBO_PALETTES,
  ...BG_PRESETS,
  ...ADDITIONAL_PALETTES,
];
