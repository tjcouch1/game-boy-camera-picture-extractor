import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage.js";
import type { PaletteEntry } from "../data/palettes.js";

const STORAGE_KEY = "gbcam-app-settings";

export interface AppSettings {
  debug: boolean;
  clipboardEnabled: boolean;
  outputScale: number;
  previewScale: number;
  paletteSelection?: PaletteEntry;
}

const DEFAULTS: AppSettings = {
  debug: false,
  clipboardEnabled: false,
  outputScale: 1,
  previewScale: 2,
};

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>(
    STORAGE_KEY,
    DEFAULTS,
  );

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings],
  );

  return { settings: { ...DEFAULTS, ...settings }, updateSetting };
}
