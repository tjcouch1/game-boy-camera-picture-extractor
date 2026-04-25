# Game Boy Color Palette Tables

Extracted palette data from the Game Boy Color bootstrap ROM color tables.

The data in this folder is transformed from the data found at [File:CGB Bootstrap ROM tables.7z](https://tcrf.net/File:CGB_Bootstrap_ROM_tables.7z).

That data and therefore the data in this folder (and no other content in this repository unless otherwise noted) carries the [Attribution 3.0 Unported license](https://creativecommons.org/licenses/by/3.0/)

## Files

### game-boy-camera-palettes.csv

The 29 background (BG) palettes assigned to table entries 0x00 through 0x1C. Each entry has four colors (0x00–0x03). Entries that correspond to a button combo (e.g. Right, A + Down) have that noted as well.

### game-boy-color-additional-palettes.csv

10 additional unique four-color palettes found in OBJ0 and OBJ1 layers that are not already covered by the BG palettes above. Each row notes the table number, table entry, and layer where the palette first appears.

## File format

The following quoted sections are excerpt directly from [File:CGB Bootstrap ROM tables.7z](https://tcrf.net/File:CGB_Bootstrap_ROM_tables.7z)'s `ReadMe.txt`:

> Reference:
> 
>   - Table Number:
>       Number of the color table, 0x00 thru 0x05. Internal values 0x06 
>       and 0x07 map to 0x05 are are unused in the original tables.
> 
>   - Table Entry:
>       Index of color palettes (BG, OBJ0, OBJ1) within a color table.

> 
>   - Button Combo:
>       The combination of buttons that triggers the color table entry 
>       in question.
> 
>   - BG/OBJ0/OBJ1 Color 0x00-0x04:
>       The color of the respective palettes in standard HTML notation. 
>       The colors were not corrected in any way to account for the 
>       actual screen color of a Game Boy Color.

  - Layer:
      Which object layer of the Game Boy Color the palette applies to (`game-boy-color-additional-palettes.csv` only)

Note:

> Entry 0x03/0x1C with hash 0x00 is actually a dummy entry. All games 
> without a Nintendo licensee id (either old or new) or which cannot be 
> found in the table get assigned this entry, hence no game title is 
> in the text files.

The Game Boy Camera uses this dummy entry by default.