<!-- The contents of this file go in the "Instructions" in a Claude Desktop Project with the Desktop Commander extension installed -->

# Desktop Environment

You are running with the Desktop Commander extension. You should use its MCP server to access the file system and run commands.

All your work should be done in the repo directory found at `%USERPROFILE%/source/repos/game-boy-camera-screenshot-extractor`. Create and edit files in that directory, and run commands in that directory.

**You MUST execute python scripts in the `.venv`. All script executions must be in the `%USERPROFILE%/source/repos/game-boy-camera-screenshot-extractor` directory.**

# Overview

You are working on a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

## Running the script

You can run the script itself with something along the following lines:

```
python gbcam_extract.py --dir sample-pictures --output-dir ./sample-pictures-out --clean-steps --debug
```

## Running the test suite

To run the test suite that runs the script on a set of pictures in `sample-pictures` and also runs the unit tests on images in the `test-input` folder (including reference images named the same thing as the tests with `-output-corrected.png` e.g. `zelda-poster-1.png` and `zelda-poster-output-corrected.png`) with a nice output that summarizes all the test results, run the following:

```
python run_tests.py
```

There will be lots of debug output in the `test-output` folder you can use to consider how to make improvements. For example, the test results summary will be at `test-output\test-summary.log`.

## Running an individual image through a test

To run a unit test to test the accuracy of the output, gather the following:

- Input image: an input picture of a Game Boy Camera picture [as described below](#taking-pictures-that-work-with-this-script) (e.g. `test-input/zelda-poster-1.jpg`)
- Reference image: a perfectly digitized 128x112 reproduction of the input Game Boy Camera picture (e.g. `test-input/zelda-poster-output-corrected.png`)

Then run the following:

```bash
python test_pipeline.py --input "test-input/zelda-poster-1.jpg" --reference "test-input/zelda-poster-output-corrected.png" --output-dir ./test-output/zelda-poster-1 --keep-intermediates
```

# Goal

Your goal is to improve the script to increase the accuracy of the transformation. You can [run the test suite](#running-the-test-suite) to track your progress.

# Repo contents

The following are important files and directories to note in the repository/directory:

- `.venv` - the python venv you must use to execute python scripts
- `sample-pictures/` - contains sample input images that get run through the transformation script in the test suite
- `sample-pictures-out/` - contains the output of the transformation script from the pictures in `sample-pictures/`
- `supporting-materials/` - contains some helpful reference files
  - `supporting-materials/Frame 02.png` - a 160x144 image which is a grayscale palette swap of the exact frame as it is displayed on the Game Boy Screen. See below for more details including palette swap mapping.
  - `supporting-materials/frame_ascii.txt` - a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. See below for more details including character-to-palette mapping.
- `test-input/` - contains multiple input images of the same Game Boy Camera picture named `<image_name>-<number>.jpg` and a reference image `<image_name>-output-corrected.png` containing the intended output Game Boy Camera picture for that set of input images. Note that these reference images use the same grayscale color palette as `supporting-materials/Frame 02.png` as detailed below, not the RGB color palette.
- `test-output/` - Contains the output of the transformation script from the pictures in `test-input/` as a result of [running the test suite](#running-the-test-suite). Each test input image has its own folder with all its output, and there is a summary of test results at `test-input/test-summary.log`.
- `gbcam_extract.py` - the main transformation script that orchestrates the transformation process by calling scripts that handle various steps of the process
- `gbcam_<step>.py` - various step scripts that do one part of the transformation process
- `run_tests.py` - runs the test suite
- `test_pipeline.py` - runs the transformation script on one test file
- Various other `.py` files - analysis files that can be run to gather additional info in particular situations

# Explanation of the input image

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. The phone picture is cropped so it just has the Game Boy screen with some dark areas around it from the Game Boy Advance SP screen. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which washes out the colors) on the outside. Around the Game Boy picture, there will be a light (#FFFFA5) rectangular frame with dark (primarily #000000) dashes around the middle of the frame that measures 160x144. The inner edge of the frame will consist of a one-screen-pixel border in the second darkest color (originally #9494FF but will be washed out). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFA5

#FF9494

#9494FF

#000000

Because this picture is a rough phone picture of a Game Boy Advance SP screen, there are some implications on the quality of the image:

- Perspective distortion - the phone picture is not perfectly aligned with the Game Boy Advance SP screen and will not be taken perfectly straight-on. The Game Boy Camera picture will not be perfectly rectangular and may not be straight up-and-down. There will be lens distortion as well.
- Pixel bleeding - though there are tiny gaps between pixels on the screen as mentioned below, this picture-of-a-picture method causes some of the brighter pixels on the SP screen to somewhat bleed over into the dimmer pixels around them.

The Game Boy Advance SP screen is front-lit and rather old technologically, which has some implications on the quality of the image:

- Significantly washed out/tinted colors - the front light brightens the screen with a somewhat blue tint, but the tint looks different in different lighting
- Unevenly distorted colors - the front light brightens the screen unevenly. There are distinct horizontal lines on the dark part of the screen around the Game Boy Camera image that indicate how much each row of screen pixels is unevenly brightened relative to the rest of the screen. Additionally, there may be some very slightly darker or lighter areas on the screen.
- Gaps between pixels - there are tiny gaps between the pixels on the screen. These gaps are especially noticeable side-to-side in that there are vertical lines between most pixel columns that are visually darker than the columns of actual pixels next to them. These gaps are also somewhat noticeable up-and-down in darker areas in that there are some horizontal lines that are noticeable especially in darker areas. These horizontal lines are especially noticeable on the dark parts on the sides of the screen around the Game Boy Camera image. However, on the Game Boy Camera image, especially in the lighter areas, most of the horizontal lines and some the vertical lines are not particularly noticeable because of the screen pixel bleeding mentioned above
- Sub-pixel colors - each pixel on the Game Boy Advance SP screen (which is a TN LCD display) has subpixel lights with blue on the left, green in the middle, and red on the right. You may notice various parts of the SP pixels are dark based on these sub-pixel colors. For example, a red pixel will be aligned more to the right side of the pixel, whereas a yellow pixel will be aligned more toward the middle of the pixel.

The phone picture will contain the following (first is outermost, last is innermost):

1. Dark outside areas of the Game Boy Advance SP screen (will have lots of uneven darkness as mentioned above). In the middle of this area, there is the following:
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide #FFFFA5 area and a one-pixel-thick inside border which is the second-to-darkest color #9494FF. The #FFFFA5 frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the #FFFFA5 frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the #FFFFA5 frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. `supporting-materials/Frame 02.png` is a 160x144 image which is a grayscale palette swap of the exact frame as it is displayed on the Game Boy Screen. The grayscale palette translates to the image colors like so:

#FFFFFF -> #FFFFA5

#A5A5A5 -> #FF9494

#525252 -> #9494FF

#000000 -> #000000

Directly inside the frame, there is the following: 3. The Game Boy Camera picture which is 128x112 SP pixels large. In `supporting-materials/Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

`supporting-materials/frame_ascii.txt` is a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. It uses the following characters to represent the colors:

#FFFFA5 -> ` `

#FF9494 -> `·`

#9494FF -> `▓`

#000000 -> `█`

# Explanation of the script

The script intends to approximately follows these steps:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that represents the Game Boy screen (160:144 proportions). See the description of the contents of the Game Boy Advance SP screen above for information about how to find the right area. This area should contain the #FFFFA5 frame with black dashes. Make sure to consider perspective distortion as mentioned above; the area will not be a rectangle, but it will have the features mentioned in the Game Boy screen like the #FFFFA5 frame with black dashes (as seen in `supporting-materials/Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are dark and the edge-most pixels inside the area are very light (because the frame is #FFFFA5)

3. Perform some corrections on the Game Boy Screen area. You will likely benefit from using some of the context around the Game Boy Camera picture area to aid in making these corrections. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Screen area into a proper rectangle with the 160:144 proportions. Make sure to account for perspective distortion as mentioned above to transform the perspective-warped screen into a rectangle.
   - Color correct the issues mentioned above like significantly washed out/tinted colors and unevenly distorted colors. The frame is supposed to be all flat #FFFFA5. So you can tell which areas are inappropriately lightened, darkened, or tinted based on the colors on the frame. Note that you will need to account for the dashes being in the frame; it's not all #FFFFA5. You need to color correct both rows and columns.
   - Check your work by determining if the edges of the area are very light (because the frame is #FFFFA5) and if the black dashed lines in the frame are exactly straight. The ones on the left and right side of the image should be vertical, and the ones on the top and bottom of the image should be horizontal.

4. Find the area in the Game Boy screen area that represents the Game Boy Camera picture area (128:112 proportions). See the description of the contents of the Game Boy Camera picture above for information about how to find the right area. This area should be one "pixel" in from the #9494FF inside border of the frame. Make sure to check for perspective distortion again as mentioned above; the area will possibly not be a rectangle, but it will be directly inside the one-pixel-thick #9494FF inside border of the frame (as seen in `supporting-materials/Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are all the same #9494FF color and this area is approximately relatively smaller than the Game Boy screen area by the right amount (160:144 -> 128:112).

5. Perform some corrections on the Game Boy Camera picture area:
   - Transform the Game Boy Camera picture area into a proper rectangle with the 128:112 proportions. Make sure to account for perspective distortion as mentioned above.

6. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel. Make sure to account for the pixel bleeding, gaps between pixels, and TN LCD screen color positioning as mentioned above.

7. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents. Make sure to account for the pixel bleeding, gaps between pixels, and TN LCD screen color positioning as mentioned above. For example, it might be a bit challenging to see a darker pixel between two lighter pixels.

8. Save the Game Boy Camera picture file as a png.

9. Palette swap the Game Boy Camera picture to the grayscale palette and save as a png.
