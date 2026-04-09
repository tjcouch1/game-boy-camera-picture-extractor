# game-boy-camera-picture-extractor

EXPERIMENTAL: Extracts and cleans a Game Boy Camera image from a picture

# Introduction

WARNING: This script is not fully successful yet. Please back up your Game Boy Camera images in other ways before deleting them.

This repository contains a script that accepts a picture of a Game Boy Camera screen displaying a Game Boy Camera image and outputs the GameBoy Camera image in 128x112 in four colors. This script is intended to clean Game Boy Camera images retrieved via taking a picture, but it probably would also work with relatively high-quality [Video Capture](https://funtography.online/wiki/Exporting_images_from_the_Game_Boy_Camera#video_capture) (I tried using my [Dazzle DVC100](https://www.pinnaclesys.com/en/products/dazzle/dvd-recorder-hd/), notorious for its low quality video capture, but it did not work). Please note that this is admittedly probably the lowest-quality method of transferring Game Boy Camera images; if you do not have the hardware needed to use this script, you will likely find more success at a more affordable price by pursuing [other avenues](https://funtography.online/wiki/Exporting_images_from_the_Game_Boy_Camera) for transferring your Game Boy Camera images. This script aims to accomplish the goal of transferring Game Boy Camera images with specific hardware that I already own.

DISCLAIMER: Though this `README.md` is not AI-generated, the code in this repo is almost exclusively AI-generated. It likely contains errors, bad code quality and standards, and does not satisfy the need perfectly.

# Taking pictures that work with this script

To collect the pictures I used with this script, I used the following hardware:

- Game Boy Advance SP AGS-001 (front-lit screen)
- Game Boy Camera (US/Europe)
- Samsung Galaxy S20 Camera

Though I didn't try any other hardware, I expect other hardware like moderate-quality screenshots from video capture devices or pictures from the Game Boy Advance SP AGS-101 may work. The picture needs to contain the entire Game Boy screen (not the entire SP screen, but just the 160x144 region representing the Game Boy screen) and needs to be clear and bright enough to distinguish the pixels on the screen relatively well. I suspect Japanese Game Boy Cameras may not work very well because [their Frame 02 is different than the Frame 02 in the US/Europe version](https://tcrf.net/Game_Boy_Camera/Regional_Differences#Frames), and I don't see a matching frame in the Japanese version.

I performed the following steps to get the pictures the way they need to be to work with this script:

1. Find a very dark room (ideally; the script aims to work with various lighting environments).
2. Turn on the Game Boy Advance SP. Make sure the frontlight is turned on. While it boots up, hold Down to use the [0x17 Game Boy Color palette](https://tcrf.net/Notes:Game_Boy_Color_Bootstrap_ROM#Assigned_Palette_Configurations).
3. In the Game Boy Camera game, navigate through the menu options to view the album.
4. Select an image. Once you select it, change the frame to [Frame 02](https://tcrf.net/images/5/50/GBCamera-Frame02-INT.png) (white with black dashes):

   ![Frame 02](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/supporting-materials/Frame%2002.png)

5. Line up the camera with the Game Boy Advance SP screen (approximately; I did this by hand, and it worked fine). Take a picture of the SP screen. Make sure the picture is very well focused and shows the individual pixels on the screen.
6. Crop the image and rotate it so the Game Boy Screen (the 160x144 region that has the frame, not the entire SP screen) is approximately centered with just a little bit of dark screen around it and is relatively straight.

The picture should look like the following:

![Sample picture ready for processing](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/sample-pictures/20260313_213430.jpg)

See `sample-pictures` for more examples of what the pictures need to look like.

After processing, the output picture should look like the following:

![Sample output picture](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/sample-pictures-out-py/20260313_213430_gbcam.png)

# Contents

This repository is a pnpm monorepo that contains multiple packages in `/packages`:

- `gbcam-extract` - TypeScript Game Boy Camera image processing pipeline
- `gbcam-extract-web` - Static site hosting the TypeScript Game Boy Camera image processing pipeline for portable and offline use
- `gbcam-extract-py` - original Python Game Boy Camera image processing pipeline (included for historical reasons but will not be updated)

# TypeScript development instructions

TODO: expand

## TypeScript Setup

```bash
pnpm i
```

## To build the TypeScript packages

```bash
pnpm build
```

## To run TypeScript tests

```bash
pnpm test
pnpm test:pipeline
```

## To run the extraction pipeline locally in Node

```bash
pnpm extract --dir ../../sample-pictures --output-dir ../../sample-pictures-out --clean-steps
```

## To run the website locally

To run just on your computer:

```bash
pnpm dev
```

To run on your network:

```bash
pnpm dev:host
```

# Python development instructions

## Python Setup

TODO: Update with the latest instructions as of mono-repo

```bash
cd packages/gbcam-extract-py
python -m venv .venv
# Unix-based
source .venv/bin/activate
# Windows
./.venv/Scripts/activate
pip install -r requirements.txt
```

### To regenerate `requirements.txt`

Inside `packages/gbcam-extract-py` after [activating the `.venv`](#python-setup):

```bash
pip install pipreqs
pipreqs . --ignore=.venv --encoding=utf8 --force
```

## To run the extraction pipeline locally in Python

Inside `packages/gbcam-extract-py` after [activating the `.venv`](#python-setup):

To generate the sample output pictures from the sample input pictures, run the script as follows:

```bash
python gbcam_extract.py --dir ../../sample-pictures --output-dir ../../sample-pictures-out-py --clean-steps
```

To generate the sample images for each step for just one sample input picture, run the script as follows:

```bash
python gbcam_extract.py ../../sample-pictures/20260313_213430.jpg --output-dir ../../sample-pictures-out-py
```

The following command-line arguments are reasonably useful:

- `--help`, `-h` - print information about the script, all its command-line arguments, its process for transforming images, and usage examples
- `<file-paths>` - provide file paths or globs to input files to transform
- `--dir` - specify directory to search for input files
- `--output-dir` - specify directory to put output files
- `--start <step>` - specify a starting step at which to process files (useful for adjusting individual steps in the process). See the printed help info for options. Defaults to `warp` (the first step)
- `--end <step>` - specify a final step for processing files. See the printed help info for options. Defaults to `quantize` (the last step)
- `--debug` - outputs information about the process of transforming the image and outputs many images detailing the transformation process
- `--clean-steps` - after processing images, delete the intermediate step out files (or put them in the `debug` folder if `--debug` was provided)

See the help information for additional details like usage examples (please note that the help info is AI-generated):

```bash
python gbcam_extract.py --help
```

## To Test

Inside `packages/gbcam-extract-py` after [activating the `.venv`](#python-setup):

To run the full test suite that regenerates all the images checked into this repo, run the following:

```bash
python run_tests.py
```

This will run commands like the following:

```bash
python gbcam_extract.py --dir ../../sample-pictures --output-dir ../../sample-pictures-out-py --clean-steps --debug
python test_pipeline.py --input "../../test-input/zelda-poster-1.jpg" --reference "../../test-input/zelda-poster-output-corrected.png" --output-dir ../../test-output-py/zelda-poster-1 --keep-intermediates
python test_pipeline.py --input "../../test-input/zelda-poster-2.jpg" --reference "../../test-input/zelda-poster-output-corrected.png" --output-dir ../../test-output-py/zelda-poster-2 --keep-intermediates
python test_pipeline.py --input "../../test-input/thing-1.jpg" --reference "../../test-input/thing-output-corrected.png" --output-dir ../../test-output-py/thing-1 --keep-intermediates
python test_pipeline.py --input "../../test-input/thing-2.jpg" --reference "../../test-input/thing-output-corrected.png" --output-dir ../../test-output-py/thing-2 --keep-intermediates
```

To run a unit test to test the accuracy of the output, gather the following:

- Input image: an input picture of a Game Boy Camera picture [as described above](#taking-pictures-that-work-with-this-script) (e.g. `test-input/zelda-poster-1.jpg`)
- Reference image: a perfectly digitized 128x112 reproduction of the input Game Boy Camera picture (e.g. `test-input/zelda-poster-output-corrected.png`)

Then run the following:

```bash
python test_pipeline.py --input "../../test-input/zelda-poster-1.jpg" --reference "../../test-input/zelda-poster-output-corrected.png" --output-dir ../../test-output-py/zelda-poster-1 --keep-intermediates
```

# Roadmap

- Initial crop from phone picture to cropped and rotated image that is input to "warp" step
- Add color palette selection
- WebAssembly
- Make a GitHub Pages frontend
- PWA for offline use
