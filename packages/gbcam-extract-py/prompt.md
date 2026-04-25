Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

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
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide #FFFFA5 area and a one-pixel-thick inside border which is the second-to-darkest color #9494FF. The #FFFFA5 frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the #FFFFA5 frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the #FFFFA5 frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. Attached is a 160x144 image called `Frame 02.png` which is a grayscale palette swap of the exact frame as it is displayed on the Game Boy Screen. The grayscale palette translates to the image colors like so:

#FFFFFF -> #FFFFA5

#A5A5A5 -> #FF9494

#525252 -> #9494FF

#000000 -> #000000

Directly inside the frame, there is the following: 3. The Game Boy Camera picture which is 128x112 SP pixels large. In attached `Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

Attached is `frame_ascii.txt`, which is a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. It uses the following characters to represent the colors:

#FFFFA5 -> ` `

#FF9494 -> `·`

#9494FF -> `▓`

#000000 -> `█`

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that represents the Game Boy screen (160:144 proportions). See the description of the contents of the Game Boy Advance SP screen above for information about how to find the right area. This area should contain the #FFFFA5 frame with black dashes. Make sure to consider perspective distortion as mentioned above; the area will not be a rectangle, but it will have the features mentioned in the Game Boy screen like the #FFFFA5 frame with black dashes (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are dark and the edge-most pixels inside the area are very light (because the frame is #FFFFA5)

3. Perform some corrections on the Game Boy Screen area. You will likely benefit from using some of the context around the Game Boy Camera picture area to aid in making these corrections. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Screen area into a proper rectangle with the 160:144 proportions. Make sure to account for perspective distortion as mentioned above to transform the perspective-warped screen into a rectangle.
   - Color correct the issues mentioned above like significantly washed out/tinted colors and unevenly distorted colors. The frame is supposed to be all flat #FFFFA5. So you can tell which areas are inappropriately lightened, darkened, or tinted based on the colors on the frame. Note that you will need to account for the dashes being in the frame; it's not all #FFFFA5. You need to color correct both rows and columns.
   - Check your work by determining if the edges of the area are very light (because the frame is #FFFFA5) and if the black dashed lines in the frame are exactly straight. The ones on the left and right side of the image should be vertical, and the ones on the top and bottom of the image should be horizontal.

4. Find the area in the Game Boy screen area that represents the Game Boy Camera picture area (128:112 proportions). See the description of the contents of the Game Boy Camera picture above for information about how to find the right area. This area should be one "pixel" in from the #9494FF inside border of the frame. Make sure to check for perspective distortion again as mentioned above; the area will possibly not be a rectangle, but it will be directly inside the one-pixel-thick #9494FF inside border of the frame (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are all the same #9494FF color and this area is approximately relatively smaller than the Game Boy screen area by the right amount (160:144 -> 128:112).

5. Perform some corrections on the Game Boy Camera picture area:
   - Transform the Game Boy Camera picture area into a proper rectangle with the 128:112 proportions. Make sure to account for perspective distortion as mentioned above.

6. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel. Make sure to account for the pixel bleeding, gaps between pixels, and TN LCD screen color positioning as mentioned above.

7. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents. Make sure to account for the pixel bleeding, gaps between pixels, and TN LCD screen color positioning as mentioned above. For example, it might be a bit challenging to see a darker pixel between two lighter pixels.

8. Save the Game Boy Camera picture file as a png.

9. Palette swap the Game Boy Camera picture to the grayscale palette and save as a png.

Make sure to add a command-line argument to print debug logs to investigate problems and respond to feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

An example of a Game Boy Camera picture with very clear edges is `20260313_213430.jpg`. An example with unclear edges is `20260313_213416.jpg`.

Also attached are some test files with exactly correct reference Game Boy Camera pictures you can use to test your work to get the algorithm right. Write a unit test that takes an input phone picture along with a reference Game Boy Camera picture, runs the transformation on the input picture, then checks it against the reference picture. There should be lots of helpful output data on what is not correct such as a full list of which pixels are not correct, which color they are, and which color they should be. Make sure running the test provides as much debug and output info as possible in order to have all the information you need to correct the problem.

Run the tests with the attached `zelda-poster-1.jpg` and `zelda-poster-2.jpg` with `zelda-poster-output-corrected.png` as the reference image. And run the tests with the attached `thing-1.jpg` and `thing-2.jpg` with `thing-output-corrected.png` as the reference image. Note that these reference images use the grayscale color palette, not the RGB color palette. Feel free to add a step in the test that transforms their colors to the RBG color palette if desired for accurate comparison.

Once you have made the script, split up the script into steps so there is an overall script that accepts the command-line args, collects the source images, runs the step scripts, then outputs the transformed images to be input into the next step script. I want to be able to run the overall script and tell it which step in the process to start on (in this case, the input images will be the output from the previous step), then it finishes the process. Make sure the steps are referred to by names, not just step numbers.

Add command-line help -h and --help that explains the overall process including each step in order. Each step should include a description of what it does.
