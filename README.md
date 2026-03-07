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

1. Find a very dark room.
2. Turn on the Game Boy Advance SP. Make sure the frontlight is turned on. While it boots up, hold B+Left to use the [Grayscale Game Boy Color palette](https://tcrf.net/Notes:Game_Boy_Color_Bootstrap_ROM#Assigned_Palette_Configurations).
3. In the Game Boy Camera game, navigate through the menu options to view the album.
4. Select an image. Once you select it, change the frame to [Frame 02](https://tcrf.net/images/5/50/GBCamera-Frame02-INT.png) (white with black dashes):

   ![Frame 02](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/supporting-materials/Frame%2002.png)

5. Line up the camera with the Game Boy Advance SP screen (approximately; I did this by hand, and it worked fine). Take a picture of the SP screen. Make sure the picture is very well focused and shows the individual pixels on the screen.
6. Crop the image and rotate it so the Game Boy Screen (the 160x144 region that has the frame, not the entire SP screen) is approximately centered with just a little bit of dark screen around it and is relatively straight.

The picture should look like the following:

![Sample picture ready for processing](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/sample-pictures/20260216_130838~2.jpg)

See `sample-pictures` for more examples of what the pictures need to look like.

After processing, the output picture should look like the following:

![Sample output picture](https://github.com/tjcouch1/game-boy-camera-screenshot-extractor/blob/main/sample-pictures-out/20260216_130838~2_gbcam.png)

# Setup

```bash
python -m venv .venv
# Unix-based
source .venv/bin/activate
# Windows
./.venv/Scripts/activate
pip install -r requirements.txt
```

## To regenerate `requirements.txt`

```bash
pip install pipreqs
pipreqs . --ignore=.venv --encoding=utf8 --force
```

# To run

To generate the sample output pictures from the sample input pictures, run the script as follows:

```bash
python gbcam_extract.py --dir sample-pictures --output-dir ./sample-pictures-out --clean-steps
```

To generate the sample images for each step for just one sample input picture, run the script as follows:

```bash
python gbcam_extract.py sample-pictures/20260216_130838~2.jpg --output-dir ./sample-pictures-out
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

# Roadmap

- Adjust parameters to find the best settings and make them default
  - Hand-edit an existing image to be correct, then make unit test and have the AI run it until it matches?
- Initial crop from phone picture to cropped and rotated image that is input to "warp" step
- Add color palette selection
