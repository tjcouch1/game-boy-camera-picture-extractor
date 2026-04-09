import { useState } from "react";
import {
  BUTTON_COMBO_PALETTES,
  BG_PRESETS,
  ADDITIONAL_PALETTES,
} from "../data/palettes.js";
import type { PaletteEntry } from "../data/palettes.js";
import { useUserPalettes } from "../hooks/useUserPalettes.js";

interface PalettePickerProps {
  selected: [string, string, string, string];
  onSelect: (palette: [string, string, string, string]) => void;
}

function PaletteSwatch({
  entry,
  isSelected,
  onClick,
  onDelete,
}: {
  entry: PaletteEntry;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
        isSelected
          ? "bg-blue-600 ring-2 ring-blue-400"
          : "bg-gray-700 hover:bg-gray-600"
      }`}
    >
      <div className="flex shrink-0">
        {entry.colors.map((c, i) => (
          <div
            key={i}
            className="w-4 h-4 first:rounded-l last:rounded-r"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <span className="truncate">{entry.name}</span>
      {onDelete && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-auto text-red-400 hover:text-red-300 cursor-pointer"
        >
          x
        </span>
      )}
    </button>
  );
}

function PaletteSection({
  title,
  entries,
  selected,
  onSelect,
  onDelete,
}: {
  title: string;
  entries: PaletteEntry[];
  selected: [string, string, string, string];
  onSelect: (colors: [string, string, string, string]) => void;
  onDelete?: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-medium text-gray-300 hover:text-white mb-1 flex items-center gap-1"
      >
        <span className="text-xs">{expanded ? "v" : ">"}</span>
        {title} ({entries.length})
      </button>
      {expanded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 ml-3">
          {entries.map((entry, i) => (
            <PaletteSwatch
              key={i}
              entry={entry}
              isSelected={entry.colors.every((c, j) => c === selected[j])}
              onClick={() => onSelect(entry.colors)}
              onDelete={onDelete ? () => onDelete(i) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PalettePicker({ selected, onSelect }: PalettePickerProps) {
  const { palettes: userPalettes, addPalette, removePalette } = useUserPalettes();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColors, setNewColors] = useState<[string, string, string, string]>([
    "#FFFFFF",
    "#AAAAAA",
    "#555555",
    "#000000",
  ]);

  const handleSave = () => {
    if (!newName.trim()) return;
    addPalette({ name: newName.trim(), colors: [...newColors] });
    setNewName("");
    setShowCreate(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-200">Palette</h2>
        <div className="flex items-center gap-2">
          <div className="flex">
            {selected.map((c, i) => (
              <div
                key={i}
                className="w-5 h-5 first:rounded-l last:rounded-r border border-gray-600"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            {showCreate ? "Cancel" : "+ Custom"}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-3 p-3 bg-gray-900 rounded">
          <div className="flex items-center gap-2 mb-2">
            {newColors.map((c, i) => (
              <label key={i} className="flex flex-col items-center gap-1">
                <input
                  type="color"
                  value={c}
                  onChange={(e) => {
                    const updated = [...newColors] as [string, string, string, string];
                    updated[i] = e.target.value;
                    setNewColors(updated);
                  }}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent"
                />
                <span className="text-[10px] text-gray-500">
                  {["Light", "Mid-L", "Mid-D", "Dark"][i]}
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Palette name"
              className="flex-1 px-2 py-1 bg-gray-700 rounded text-xs text-white placeholder-gray-500 border border-gray-600 focus:border-blue-500 outline-none"
            />
            <button
              onClick={handleSave}
              disabled={!newName.trim()}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <PaletteSection
          title="User Palettes"
          entries={userPalettes}
          selected={selected}
          onSelect={onSelect}
          onDelete={removePalette}
        />
        <PaletteSection
          title="Button Combos"
          entries={BUTTON_COMBO_PALETTES}
          selected={selected}
          onSelect={onSelect}
        />
        <PaletteSection
          title="BG Presets"
          entries={BG_PRESETS}
          selected={selected}
          onSelect={onSelect}
        />
        <PaletteSection
          title="Additional"
          entries={ADDITIONAL_PALETTES}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
