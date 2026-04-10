import { useState } from "react";
import {
  BUTTON_COMBO_PALETTES,
  BG_PRESETS,
  ADDITIONAL_PALETTES,
  FUN_PALETTES_EXPORT,
} from "../data/palettes.js";
import type { PaletteEntry } from "../data/palettes.js";
import { useUserPalettes } from "../hooks/useUserPalettes.js";
import { useDraftPalette } from "../hooks/useDraftPalette.js";

interface PalettePickerProps {
  selected: PaletteEntry;
  onSelectWithName: (entry: PaletteEntry) => void;
}

function PaletteSwatch({
  entry,
  isSelected,
  doesMatchColors,
  onClick,
  onDelete,
}: {
  entry: PaletteEntry;
  isSelected: boolean;
  doesMatchColors: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const bgClass = isSelected
    ? "bg-blue-600 ring-2 ring-blue-400"
    : doesMatchColors
      ? "bg-blue-800 hover:bg-blue-700"
      : "bg-gray-700 hover:bg-gray-600";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${bgClass}`}
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
  onSelectWithName,
  onDelete,
}: {
  title: string;
  entries: PaletteEntry[];
  selected: PaletteEntry;
  onSelectWithName: (entry: PaletteEntry) => void;
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
              isSelected={entry.name === selected.name && entry.colors.every((c, j) => c === selected.colors[j])}
              doesMatchColors={entry.colors.every((c, j) => c === selected.colors[j])}
              onClick={() => {
                onSelectWithName(entry);
              }}
              onDelete={onDelete ? () => onDelete(i) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PalettePicker({
  selected,
  onSelectWithName,
}: PalettePickerProps) {
  const {
    palettes: userPalettes,
    addPalette,
    removePalette,
  } = useUserPalettes();
  const {
    draft,
    hasDraft,
    lastNonDraftPalette,
    initializeDraft,
    updateDraftColors,
    recordNonDraftPalette,
    clearDraft,
  } = useDraftPalette();
  const [showCreate, setShowCreate] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColors, setNewColors] = useState<[string, string, string, string]>([
    "#FFFFFF",
    "#AAAAAA",
    "#555555",
    "#000000",
  ]);

  // Check if current selection matches draft
  const isDraftSelected =
    hasDraft && draft && selected.every((c, i) => c === draft[i]);

  const handleSave = () => {
    if (!newName.trim()) return;

    if (editingDraft) {
      // Saving draft as permanent palette
      addPalette({ name: newName.trim(), colors: [...newColors] });
      clearDraft();
      setEditingDraft(false);
      setShowCreate(false);
    } else {
      // Creating new custom palette from scratch
      addPalette({ name: newName.trim(), colors: [...newColors] });
      setShowCreate(false);
    }

    setNewName("");
    setNewColors(["#FFFFFF", "#AAAAAA", "#555555", "#000000"]);
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
            onClick={() => {
              if (editingDraft) {
                setEditingDraft(false);
              } else if (showCreate) {
                setShowCreate(false);
              } else {
                if (hasDraft && draft) {
                  setNewColors([...draft]);
                  setEditingDraft(true);
                } else {
                  setNewColors(["#FFFFFF", "#AAAAAA", "#555555", "#000000"]);
                }
                setShowCreate(true);
              }
            }}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            {showCreate ? "Cancel" : "+ Custom"}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-3 p-3 bg-gray-900 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              {editingDraft ? "Edit Draft" : "New Palette"}
            </span>
            {editingDraft && (
              <button
                onClick={() => {
                  clearDraft();
                  setEditingDraft(false);
                  setShowCreate(false);
                  setNewName("");
                  setNewColors(["#FFFFFF", "#AAAAAA", "#555555", "#000000"]);
                }}
                className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white transition-colors"
              >
                Delete Draft
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            {newColors.map((c, i) => (
              <label key={i} className="flex flex-col items-center gap-1">
                <input
                  type="color"
                  value={c}
                  onChange={(e) => {
                    const updated = [...newColors] as [
                      string,
                      string,
                      string,
                      string,
                    ];
                    updated[i] = e.target.value;
                    setNewColors(updated);
                    if (editingDraft) {
                      updateDraftColors(updated);
                    }
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
              placeholder={
                editingDraft ? "Palette name to save draft as" : "Palette name"
              }
              className="flex-1 px-2 py-1 bg-gray-700 rounded text-xs text-white placeholder-gray-500 border border-gray-600 focus:border-blue-500 outline-none"
            />
            <button
              onClick={handleSave}
              disabled={!newName.trim()}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
            >
              {editingDraft ? "Save" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {hasDraft && (
          <PaletteSection
            title="✏️ Draft"
            entries={draft ? [{ name: "Draft", colors: draft }] : []}
            selected={selected}
            onSelectWithName={(entry) => {
              recordNonDraftPalette(entry.colors);
              onSelectWithName(entry);
            }}
          />
        )}
        <PaletteSection
          title="User Palettes"
          entries={userPalettes}
          selected={selected}
          onSelectWithName={(entry) => {
            if (hasDraft) {
              recordNonDraftPalette(entry.colors);
            }
            onSelectWithName(entry);
          }}
          onDelete={removePalette}
        />
        <PaletteSection
          title="Button Combos"
          entries={BUTTON_COMBO_PALETTES}
          selected={selected}
          onSelectWithName={(entry) => {
            if (hasDraft) {
              recordNonDraftPalette(entry.colors);
            }
            onSelectWithName(entry);
          }}
        />
        <PaletteSection
          title="BG Presets"
          entries={BG_PRESETS}
          selected={selected}
          onSelectWithName={(entry) => {
            if (hasDraft) {
              recordNonDraftPalette(entry.colors);
            }
            onSelectWithName(entry);
          }}
        />
        <PaletteSection
          title="Additional"
          entries={ADDITIONAL_PALETTES}
          selected={selected}
          onSelectWithName={(entry) => {
            if (hasDraft) {
              recordNonDraftPalette(entry.colors);
            }
            onSelectWithName(entry);
          }}
        />
        <PaletteSection
          title="Fun"
          entries={FUN_PALETTES_EXPORT}
          selected={selected}
          onSelectWithName={(entry) => {
            if (hasDraft) {
              recordNonDraftPalette(entry.colors);
            }
            onSelectWithName(entry);
          }}
        />
      </div>
    </div>
  );
}
