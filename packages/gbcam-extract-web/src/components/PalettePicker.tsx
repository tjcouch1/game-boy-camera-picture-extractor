import { useState } from "react";
import {
  BUTTON_COMBO_PALETTES,
  BG_PRESETS,
  ADDITIONAL_PALETTES,
  FUN_PALETTES_EXPORT,
} from "../data/palettes.js";
import type { PaletteEntry } from "../data/palettes.js";
import {
  useUserPalettes,
  type UserPaletteEntry,
} from "../hooks/useUserPalettes.js";
import { usePaletteSectionState } from "../hooks/usePaletteSectionState.js";
import {
  PALETTE_COLOR_LABELS,
  PALETTE_TEXT_CLASS,
  PALETTE_LABEL_CLASS,
  PALETTE_INPUT_CLASS,
} from "../utils/paletteUI.js";

interface PalettePickerProps {
  selected: PaletteEntry;
  onSelectWithName: (entry: PaletteEntry) => void;
}

function PaletteSwatch({
  entry,
  isSelected,
  doesMatchColors,
  isBuiltIn,
  isEditing,
  onClick,
  onEdit,
}: {
  entry: PaletteEntry | UserPaletteEntry;
  isSelected: boolean;
  doesMatchColors: boolean;
  isBuiltIn: boolean;
  isEditing?: boolean;
  onClick: () => void;
  onEdit?: () => void;
}) {
  const bgClass = isSelected
    ? "bg-blue-600 ring-2 ring-blue-400"
    : doesMatchColors && isEditing
      ? "bg-blue-500 hover:bg-blue-400"
      : doesMatchColors
        ? "bg-blue-800 hover:bg-blue-700"
        : "bg-gray-700 hover:bg-gray-600";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${PALETTE_TEXT_CLASS} ${bgClass}`}
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
      {!isBuiltIn && onEdit && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="ml-auto text-blue-400 hover:text-blue-300 cursor-pointer"
          title="Edit palette"
        >
          ✏️
        </span>
      )}
    </button>
  );
}

function PaletteSection({
  title,
  entries,
  selected,
  selectedEditingPaletteId,
  onSelectWithName,
  onEdit,
  isBuiltIn,
  isExpanded,
  onToggleExpand,
}: {
  title: string;
  entries: (PaletteEntry | UserPaletteEntry)[];
  selected: PaletteEntry;
  selectedEditingPaletteId?: string;
  onSelectWithName: (entry: PaletteEntry) => void;
  onEdit?: (id: string, entry: UserPaletteEntry) => void;
  isBuiltIn?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div>
      <button
        onClick={onToggleExpand}
        className="text-sm font-medium text-gray-300 hover:text-white mb-1 flex items-center gap-1"
      >
        <span className="text-xs">{isExpanded ? "v" : ">"}</span>
        {title} ({entries.length})
      </button>
      {isExpanded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 ml-3">
          {entries.map((entry, i) => {
            const isUserPalette = "id" in entry;
            // For all palettes (user or built-in), check if name and colors match selected
            const isSelected =
              entry.name === selected.name &&
              entry.colors.every((c, j) => c === selected.colors[j]);
            const doesMatchColors = entry.colors.every(
              (c, j) => c === selected.colors[j],
            );
            const isEditing =
              isUserPalette && "isEditing" in entry && entry.isEditing;

            return (
              <PaletteSwatch
                key={isUserPalette ? (entry as UserPaletteEntry).id : i}
                entry={entry}
                isSelected={isSelected}
                doesMatchColors={doesMatchColors}
                isBuiltIn={!!isBuiltIn}
                isEditing={isEditing}
                onClick={() => {
                  onSelectWithName(
                    "id" in entry
                      ? { name: entry.name, colors: entry.colors }
                      : entry,
                  );
                }}
                onEdit={
                  isUserPalette && onEdit && !isBuiltIn
                    ? () => onEdit(i.toString(), entry as UserPaletteEntry)
                    : undefined
                }
              />
            );
          })}
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
    createPaletteInEditMode,
    updatePalette,
    savePalette,
    cancelPaletteEdit,
    deletePalette,
    startEditingPalette,
  } = useUserPalettes();

  const { isExpanded, toggleExpanded } = usePaletteSectionState();

  const [selectedEditingPaletteId, setSelectedEditingPaletteId] = useState<
    string | undefined
  >();
  const [editingPaletteErrors, setEditingPaletteErrors] = useState<string>("");

  // Get the currently editing palette (if any)
  const editingPalette =
    selectedEditingPaletteId &&
    userPalettes.find((p) => p.id === selectedEditingPaletteId);

  // Helper: check if a palette is the selected one (by name + colors match)
  const isPaletteSelected = (palette: UserPaletteEntry): boolean => {
    return (
      palette.name === selected.name &&
      palette.colors.every((c, j) => c === selected.colors[j])
    );
  };

  // Validate palette edits
  const validatePaletteName = (id: string, name: string): string => {
    if (!name.trim()) {
      return "Palette name cannot be empty";
    }
    const isDuplicate = userPalettes.some(
      (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (isDuplicate) {
      return "A palette with this name already exists";
    }
    return "";
  };

  const handleCreateCustom = () => {
    const newId = createPaletteInEditMode(selected.name, selected.colors);
    setSelectedEditingPaletteId(newId);
    // The newly created palette will be added to userPalettes via the hook's state update
    // We can just select the current selected palette colors since we're creating from it
    onSelectWithName(selected);
  };

  const handleStartEdit = (paletteId: string) => {
    startEditingPalette(paletteId);
    setSelectedEditingPaletteId(paletteId);
  };

  const handleSavePalette = (id: string) => {
    if (editingPalette) {
      const error = validatePaletteName(id, editingPalette.name);
      if (error) {
        setEditingPaletteErrors(error);
        return;
      }
    }
    savePalette(id);
    setSelectedEditingPaletteId(undefined);
    setEditingPaletteErrors("");
  };

  const handleCancelEdit = (id: string) => {
    cancelPaletteEdit(id);
    setSelectedEditingPaletteId(undefined);
    setEditingPaletteErrors("");
  };

  const handleDeletePalette = (id: string) => {
    deletePalette(id);
    setSelectedEditingPaletteId(undefined);
    setEditingPaletteErrors("");
  };

  const handlePaletteNameChange = (id: string, newName: string) => {
    const palette = userPalettes.find((p) => p.id === id);
    updatePalette(id, { name: newName });
    const error = validatePaletteName(id, newName);
    setEditingPaletteErrors(error);
    // If this palette is currently selected, update the selection to reflect new name
    if (palette && isPaletteSelected(palette)) {
      onSelectWithName({ name: newName, colors: palette.colors });
    }
  };

  const handlePaletteColorChange = (
    id: string,
    colorIndex: number,
    newColor: string,
  ) => {
    const palette = userPalettes.find((p) => p.id === id);
    if (palette) {
      const newColors = [...palette.colors] as [
        string,
        string,
        string,
        string,
      ];
      newColors[colorIndex] = newColor;
      updatePalette(id, { colors: newColors });
      // If this palette is currently selected, update the selection to reflect new colors
      if (isPaletteSelected(palette)) {
        onSelectWithName({ name: palette.name, colors: newColors });
      }
    }
  };

  const handleSelectEditingPalette = (id: string) => {
    const palette = userPalettes.find((p) => p.id === id);
    if (palette) {
      onSelectWithName({ name: palette.name, colors: palette.colors });
      setSelectedEditingPaletteId(id);
    }
  };

  const editingPalettes = userPalettes.filter((p) => p.isEditing);
  const savedUserPalettes = userPalettes.filter((p) => !p.isEditing);

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-200">Palette</h2>
        <div className="flex items-center gap-2">
          <div className="flex">
            {selected.colors.map((c: string, i: number) => (
              <div
                key={i}
                className="w-5 h-5 first:rounded-l last:rounded-r border border-gray-600"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleCreateCustom}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            + Custom
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {/* Editing Palettes Section */}
        {editingPalettes.length > 0 && (
          <div>
            <div className="text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
              <span className="text-xs">v</span>
              ✏️ EDITING ({editingPalettes.length})
            </div>
            <div className="ml-3 space-y-2">
              {editingPalettes.map((palette) => {
                const isSelected = isPaletteSelected(palette);
                return (
                  <div
                    key={palette.id}
                    className={`p-3 rounded border-2 ${
                      isSelected
                        ? "border-blue-400 bg-blue-900 ring-2 ring-blue-400"
                        : "border-gray-600 bg-gray-900 hover:bg-gray-800"
                    } cursor-pointer transition-colors`}
                    onClick={() => {
                      handleSelectEditingPalette(palette.id);
                      setSelectedEditingPaletteId(palette.id);
                    }}
                  >
                    {/* Color pickers */}
                    <div className="flex items-center gap-2 mb-2">
                      {palette.colors.map((c, i) => (
                        <label
                          key={i}
                          className="flex flex-col items-center gap-1"
                        >
                          <input
                            type="color"
                            value={c}
                            onChange={(e) => {
                              e.stopPropagation();
                              handlePaletteColorChange(
                                palette.id,
                                i,
                                e.target.value,
                              );
                            }}
                            className="w-8 h-8 rounded cursor-pointer bg-transparent"
                          />
                          <span className={PALETTE_LABEL_CLASS}>
                            {PALETTE_COLOR_LABELS[i]}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Name input */}
                    <input
                      type="text"
                      value={palette.name}
                      onChange={(e) => {
                        e.stopPropagation();
                        handlePaletteNameChange(palette.id, e.target.value);
                      }}
                      placeholder="Palette name"
                      className={`${PALETTE_INPUT_CLASS} mb-2`}
                    />

                    {/* Error message */}
                    {selectedEditingPaletteId === palette.id &&
                      editingPaletteErrors && (
                        <p className="text-red-400 text-[10px] mb-2">
                          {editingPaletteErrors}
                        </p>
                      )}

                    {/* Action buttons */}
                    <div className="flex gap-1 justify-end">
                      {palette.savedName && (
                        <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit(palette.id);
                        }}
                        className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-[10px] transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePalette(palette.id);
                      }}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-[10px] text-white transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSavePalette(palette.id);
                      }}
                      disabled={!!editingPaletteErrors}
                      className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-[10px] text-white font-medium transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* User Palettes Section */}
        <PaletteSection
          title="User Palettes"
          entries={savedUserPalettes}
          selected={selected}
          selectedEditingPaletteId={selectedEditingPaletteId}
          onSelectWithName={onSelectWithName}
          onEdit={(_, palette) => {
            const userPalette = palette as UserPaletteEntry;
            handleStartEdit(userPalette.id);
          }}
          isExpanded={isExpanded("User Palettes")}
          onToggleExpand={() => toggleExpanded("User Palettes")}
        />

        {/* Built-in Palettes Sections */}
        <PaletteSection
          title="Button Combos"
          entries={BUTTON_COMBO_PALETTES}
          selected={selected}
          selectedEditingPaletteId={selectedEditingPaletteId}
          onSelectWithName={onSelectWithName}
          isBuiltIn={true}
          isExpanded={isExpanded("Button Combos")}
          onToggleExpand={() => toggleExpanded("Button Combos")}
        />
        <PaletteSection
          title="BG Presets"
          entries={BG_PRESETS}
          selected={selected}
          selectedEditingPaletteId={selectedEditingPaletteId}
          onSelectWithName={onSelectWithName}
          isBuiltIn={true}
          isExpanded={isExpanded("BG Presets")}
          onToggleExpand={() => toggleExpanded("BG Presets")}
        />
        <PaletteSection
          title="Additional"
          entries={ADDITIONAL_PALETTES}
          selected={selected}
          selectedEditingPaletteId={selectedEditingPaletteId}
          onSelectWithName={onSelectWithName}
          isBuiltIn={true}
          isExpanded={isExpanded("Additional")}
          onToggleExpand={() => toggleExpanded("Additional")}
        />
        <PaletteSection
          title="Fun"
          entries={FUN_PALETTES_EXPORT}
          selected={selected}
          selectedEditingPaletteId={selectedEditingPaletteId}
          onSelectWithName={onSelectWithName}
          isBuiltIn={true}
          isExpanded={isExpanded("Fun")}
          onToggleExpand={() => toggleExpanded("Fun")}
        />
      </div>
    </div>
  );
}
