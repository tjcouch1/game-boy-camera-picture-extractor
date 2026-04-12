# ai-prompts.md

This file is simply a reference. It includes various prompts I used to guide the AI through creating these scripts.

# Prompt

Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. There will be things around the screen and background elements. However, at least the inner border of the frame of the Game Boy Advance SP will be in the phone picture, so the entire SP screen will be visible. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which corrupts the colors). Above the Game Boy Camera picture, the screen will show "Nintendo®". Below the Game Boy Camera picture, the screen will show "GAME BOY™". The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#7BFF31

#0063C5

#000000

The phone picture will have some distortion, and the phone picture will not be taken perfectly straight-on. The Game Boy Camera picture may not be perfectly rectangular and may not be straight up-and-down.

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that approximately represents the Game Boy Camera picture.

3. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel.

4. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents.

5. Save the file as some modern lossless image standard like png.

Make sure to add a command-line argument to print debug logs so I can give you feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

Examples of Game Boy Camera pictures with very clear edges are 20260215_210523.jpg, 20260215_210412.jpg, and 20260215_210551.jpg. An example with unclear edges is 20260215_211024.jpg.

# Prompt Frame 02

Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. There will be things around the screen and background elements. However, at least the inner border of the frame of the Game Boy Advance SP will be in the phone picture, so the entire SP screen will be visible. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which corrupts the colors) on the outside. Around the Game Boy picture, there will be a white-ish rectangular frame with black dashes around the middle of the frame. The inner edge of the frame will consist of a one-screen-pixel border in the blue color (originally #0063C5). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#7BFF31

#0063C5

#000000

The phone picture will have some distortion, and the phone picture will not be taken perfectly straight-on. The Game Boy Camera picture may not be perfectly rectangular and may not be straight up-and-down.

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that approximately represents the Game Boy Camera picture. You can especially look for the white frame with black dashes and the one-screen-pixel-wide blue inner border.

3. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel.

4. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents.

5. Save the file as some modern lossless image standard like png.

Make sure to add a command-line argument to print debug logs so I can give you feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

Examples of Game Boy Camera pictures with very clear edges are 20260215_214721.jpg and 20260215_214739.jpg. An example with unclear edges is 20260215_214627.jpg.

---

The border detection still isn't quite right. The white "paper" part is the entire original Game Boy screen, so it is 160x144 pixels. Use this knowledge to find the entire white box and shrink the area in to 128x112 from that 160x144 area.

Also, the color detection method is not working well. The Game Boy Advance SP screen seems to have some thin spacing between the pixels where it is darker. For each region of the phone picture that represents one Game Boy Camera picture pixel, it may be best to consider the phone picture pixels at the center of the area that represents one Game Boy Camera pixel as more accurate to the actual pixel color than the pixels on the outer area.

---

the Game Boy Advance SP is set to display grayscale colors that are evenly spaced. Let's change the Game Boy Advance SP colors from
#FFFFFF
#7BFF31
#0063C5
#000000

to

#FFFFFF
#A5A5A5
#525252
#000000

Hopefully that will help with detecting the exact right colors. You can use the new colors for input and output. I attached the new phone pictures of the Game Boy Camera pictures in this grayscale palette.

---

Attached is approximately the region that should be cut out in that image (a picture with everything transparent except the approximate 160:144 area of the Game Boy screen including the white frame).

---

You need to use the pattern on the frame to detect the area to use. The frame is a very distinct white with very distinct black dashes in it.

Attached is an edited version of 20260216 131047 that transforms the cut out portion from the previous attached image into a rectangle. You can see that the white frame fills the portion between the 160:144 and the 128:112 with one pixel-width of dark gray around the actual Game Boy Camera picture. You can see that there are 17 black dashes along the top and bottom approximately in the middle of the white frame, and there are 14 black dashes along the sides that are close to the outer edges of the white frame.

# Prompt Plan -> Act Frame 02 Grayscale

# Prompt Frame 02

```

Make a plan to implement the script mentioned in the pasted attached text. Inspect the attached files and consider how they relate to the problem. Make sure to carefully consider the entire problem and effective image manipulation steps and solutions. Break the problem down into steps that you can implement and chain together to make the final product.

```

Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. There will be things around the screen and background elements. Though the complete SP console will not necessarily be visible, the entire SP screen itself will be visible. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which washes out the colors) on the outside. Around the Game Boy picture, there will be a white-ish rectangular frame with black dashes around the middle of the frame that measures 160x144. The inner edge of the frame will consist of a one-screen-pixel border in the second darkest color (originally #525252 but will be washed out). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#A5A5A5

#525252

#000000

Because this picture is a rough phone picture of a Game Boy Advance SP screen, there are some implications on the quality of the image:

- Perspective distortion - the phone picture is not perfectly aligned with the Game Boy Advance SP screen and will not be taken perfectly straight-on. The Game Boy Camera picture may not be perfectly rectangular and may not be straight up-and-down. There may be some slight lens distortion as well.
- Pixel bleeding - though there are tiny gaps between pixels on the screen as mentioned below, this picture-of-a-picture method causes some of the brighter pixels on the SP screen to bleed over into the dimmer pixels around them. This pixel bleeding is especially significant vertically; in the lighter areas, it looks like there are columns of nearly uninterrupted color, whereas the gaps between pixels are still somewhat noticeable horizontally even in lighter areas.

The Game Boy Advance SP screen is front-lit and rather old technologically, which has some implications on the quality of the image:

- Significantly washed out colors
- Unevenly distorted colors - the front light brightens the screen unevenly. There are distinct horizontal lines on the dark part of the screen around the Game Boy Camera image that indicate how much each row of screen pixels is unevenly brightened relative to the rest of the screen. Additionally, there may be some very slightly darker or lighter areas on the screen.
- Gaps between pixels - there are tiny gaps between the pixels on the screen. These gaps are especially noticeable side-to-side in that there are vertical lines between most pixel columns that are visually darker than the columns of actual pixels next to them. These gaps are also somewhat noticeable up-and-down in darker areas in that there are some horizontal lines that are noticeable especially in darker areas. These horizontal lines are especially noticeable on the dark parts on the sides of the screen around the Game Boy Camera image. However, on the Game Boy Camera image, especially in the lighter areas, most of the horizontal lines and some the vertical lines are not particularly noticeable because of the screen pixel bleeding mentioned above

The Game Boy Advance SP screen (240x160 pixel resolution) will contain the following (first is outermost, last is innermost):

1. Dark outside areas of the screen (will have lots of uneven darkness as mentioned above). In the middle of this area, there is the following:
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide white area and a one-pixel-thick inside border which is the second-to-darkest color #525252. The white frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the white frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the white frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. Attached is a 160x144 image called `Frame 02.png` which is the exact frame as it is displayed on the Game Boy Screen. Directly inside the frame, there is the following:
3. The Game Boy Camera picture which is 128x112 SP pixels large. In attached `Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

Attached is `frame_ascii.txt`, which is a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. It uses the following characters to represent the colors:

#FFFFFF -> ` `

#A5A5A5 -> `·`

#525252 -> `▓`

#000000 -> `█`

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that represents the Game Boy screen (160:144 proportions). See the description of the contents of the Game Boy Advance SP screen above for information about how to find the right area. This area should contain the white frame with black dashes. Make sure to consider perspective distortion as mentioned above; the area will not be a rectangle, but it will have the features mentioned in the Game Boy screen like the white frame with black dashes (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are dark and the edge-most pixels inside the area are very light (because the frame is white)

3. Perform some corrections on the Game Boy Screen area. You will likely benefit from using some of the context around the Game Boy Camera picture area to aid in making these corrections. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Screen area into a proper rectangle with the 160:144 proportions. Make sure to account for perspective distortion as mentioned above to transform the perspective-warped screen into a rectangle.
   - Color correct the issues mentioned above like significantly washed out colors, unevenly distorted colors
   - Check your work by determining if the edges of the area are very light (because the frame is white) and if the black dashed lines in the frame are exactly straight. The ones on the left and right side of the image should be vertical, and the ones on the top and bottom of the image should be horizontal.

4. Find the area in the Game Boy screen area that represents the Game Boy Camera picture area (128:112 proportions). See the description of the contents of the Game Boy Camera picture above for information about how to find the right area. This area should be one "pixel" in from the dark gray inside border of the frame. Make sure to check for perspective distortion again as mentioned above; the area will possibly not be a rectangle, but it will be directly inside the one-pixel-thick dark gray inside border of the frame (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are all the same dark color and this area is approximately relatively smaller than the Game Boy screen area by the right amount (160:144 -> 128:112).

5. Perform some corrections on the Game Boy Camera picture area. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Camera picture area into a proper rectangle with the 128:112 proportions. Make sure to account for perspective distortion as mentioned above.

6. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels. It may be that pixels toward the center of the area are more representative of the true original color due to the pixel bleeding.

7. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels.

8. Save the file as a png.

Make sure to add a command-line argument to print debug logs to investigate problems and respond to feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

An example of a Game Boy Camera picture with very clear edges is `20260216_130838.jpg`. An example with unclear edges is `20260216_130909.jpg`.

For some examples of what steps along the way might look like, attached are some edited versions of `20260216_131047.jpg`:

- `01 Prison Cut Out.png` shows approximately the region that should be cut out in that image (the picture has everything transparent except the approximate 160:144 area of the Game Boy screen including the white frame).
- `04 Prison Alpha Channel Removed.png` is the previous image with the Game Boy screen transformed to be a 160:144 rectangle and cropped to size. You can see the 16-pixel-thick frame is around the edges, and the Game Boy Camera picture is 128:112 in the center.

# Prompt getting AI to make the final image for unit testing

```

Read the attached pasted text as a prompt and do what it says.

```

Attached is `20260216_130838~2.jpg`, a phone picture of a Game Boy Advance SP screen that is displaying a Game Boy Camera picture. The phone picture is cropped so it just has the Game Boy screen with some dark areas around it from the Game Boy Advance SP screen. I want you to turn this phone picture into an exact reproduction of the Game Boy Camera picture.

The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which washes out the colors) on the outside. Around the Game Boy picture, there will be a white-ish rectangular frame with black dashes around the middle of the frame that measures 160x144. The inner edge of the frame will consist of a one-screen-pixel border in the second darkest color (originally #525252 but will be washed out). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#A5A5A5

#525252

#000000

Because this picture is a rough phone picture of a Game Boy Advance SP screen, there are some implications on the quality of the image:

- Perspective distortion - the phone picture is not perfectly aligned with the Game Boy Advance SP screen and will not be taken perfectly straight-on. The Game Boy Camera picture may not be perfectly rectangular and may not be straight up-and-down. There may be some slight lens distortion as well.
- Pixel bleeding - though there are tiny gaps between pixels on the screen as mentioned below, this picture-of-a-picture method causes some of the brighter pixels on the SP screen to bleed over into the dimmer pixels around them. This pixel bleeding is especially significant vertically; in the lighter areas, it looks like there are columns of nearly uninterrupted color, whereas the gaps between pixels are still somewhat noticeable horizontally even in lighter areas.

The Game Boy Advance SP screen is front-lit and rather old technologically, which has some implications on the quality of the image:

- Significantly washed out colors
- Unevenly distorted colors - the front light brightens the screen unevenly. There are distinct horizontal lines on the dark part of the screen around the Game Boy Camera image that indicate how much each row of screen pixels is unevenly brightened relative to the rest of the screen. Additionally, there may be some very slightly darker or lighter areas on the screen.
- Gaps between pixels - there are tiny gaps between the pixels on the screen. These gaps are especially noticeable side-to-side in that there are vertical lines between most pixel columns that are visually darker than the columns of actual pixels next to them. These gaps are also somewhat noticeable up-and-down in darker areas in that there are some horizontal lines that are noticeable especially in darker areas. These horizontal lines are especially noticeable on the dark parts on the sides of the screen around the Game Boy Camera image. However, on the Game Boy Camera image, especially in the lighter areas, most of the horizontal lines and some the vertical lines are not particularly noticeable because of the screen pixel bleeding mentioned above

The Game Boy Advance SP screen will contain the following (first is outermost, last is innermost):

1. Dark outside areas of the screen (will have lots of uneven darkness as mentioned above). In the middle of this area, there is the following:
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide white area and a one-pixel-thick inside border which is the second-to-darkest color #525252. The white frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the white frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the white frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. Attached is a 160x144 image called `Frame 02.png` which is the exact frame as it is displayed on the Game Boy Screen. Directly inside the frame, there is the following:
3. The Game Boy Camera picture which is 128x112 SP pixels large. In attached `Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

# Prompt Plan -> Act Frame 02 Grayscale Cropped

```

Make a plan to implement the script mentioned in the pasted attached text. Inspect the attached files and consider how they relate to the problem. Make sure to carefully consider the entire problem and effective image manipulation steps and solutions. Break the problem down into steps that you can implement and chain together to make the final product.

```

Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. The phone picture is cropped so it just has the Game Boy screen with some dark areas around it from the Game Boy Advance SP screen. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which washes out the colors) on the outside. Around the Game Boy picture, there will be a white-ish rectangular frame with black dashes around the middle of the frame that measures 160x144. The inner edge of the frame will consist of a one-screen-pixel border in the second darkest color (originally #525252 but will be washed out). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#A5A5A5

#525252

#000000

Because this picture is a rough phone picture of a Game Boy Advance SP screen, there are some implications on the quality of the image:

- Perspective distortion - the phone picture is not perfectly aligned with the Game Boy Advance SP screen and will not be taken perfectly straight-on. The Game Boy Camera picture will not be perfectly rectangular and may not be straight up-and-down. There will be lens distortion as well.
- Pixel bleeding - though there are tiny gaps between pixels on the screen as mentioned below, this picture-of-a-picture method causes some of the brighter pixels on the SP screen to bleed over into the dimmer pixels around them. This pixel bleeding is especially significant vertically; in the lighter areas, it looks like there are columns of nearly uninterrupted color, whereas the gaps between pixels are still somewhat noticeable horizontally even in lighter areas.

The Game Boy Advance SP screen is front-lit and rather old technologically, which has some implications on the quality of the image:

- Significantly washed out colors
- Unevenly distorted colors - the front light brightens the screen unevenly. There are distinct horizontal lines on the dark part of the screen around the Game Boy Camera image that indicate how much each row of screen pixels is unevenly brightened relative to the rest of the screen. Additionally, there may be some very slightly darker or lighter areas on the screen.
- Gaps between pixels - there are tiny gaps between the pixels on the screen. These gaps are especially noticeable side-to-side in that there are vertical lines between most pixel columns that are visually darker than the columns of actual pixels next to them. These gaps are also somewhat noticeable up-and-down in darker areas in that there are some horizontal lines that are noticeable especially in darker areas. These horizontal lines are especially noticeable on the dark parts on the sides of the screen around the Game Boy Camera image. However, on the Game Boy Camera image, especially in the lighter areas, most of the horizontal lines and some the vertical lines are not particularly noticeable because of the screen pixel bleeding mentioned above

The phone picture will contain the following (first is outermost, last is innermost):

1. Dark outside areas of the Game Boy Advance SP screen (will have lots of uneven darkness as mentioned above). In the middle of this area, there is the following:
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide white area and a one-pixel-thick inside border which is the second-to-darkest color #525252. The white frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the white frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the white frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. Attached is a 160x144 image called `Frame 02.png` which is the exact frame as it is displayed on the Game Boy Screen. Directly inside the frame, there is the following:
3. The Game Boy Camera picture which is 128x112 SP pixels large. In attached `Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

Attached is `frame_ascii.txt`, which is a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. It uses the following characters to represent the colors:

#FFFFFF -> ` `

#A5A5A5 -> `·`

#525252 -> `▓`

#000000 -> `█`

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that represents the Game Boy screen (160:144 proportions). See the description of the contents of the Game Boy Advance SP screen above for information about how to find the right area. This area should contain the white frame with black dashes. Make sure to consider perspective distortion as mentioned above; the area will not be a rectangle, but it will have the features mentioned in the Game Boy screen like the white frame with black dashes (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are dark and the edge-most pixels inside the area are very light (because the frame is white)

3. Perform some corrections on the Game Boy Screen area. You will likely benefit from using some of the context around the Game Boy Camera picture area to aid in making these corrections. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Screen area into a proper rectangle with the 160:144 proportions. Make sure to account for perspective distortion as mentioned above to transform the perspective-warped screen into a rectangle.
   - Color correct the issues mentioned above like significantly washed out colors, unevenly distorted colors
   - Check your work by determining if the edges of the area are very light (because the frame is white) and if the black dashed lines in the frame are exactly straight. The ones on the left and right side of the image should be vertical, and the ones on the top and bottom of the image should be horizontal.

4. Find the area in the Game Boy screen area that represents the Game Boy Camera picture area (128:112 proportions). See the description of the contents of the Game Boy Camera picture above for information about how to find the right area. This area should be one "pixel" in from the dark gray inside border of the frame. Make sure to check for perspective distortion again as mentioned above; the area will possibly not be a rectangle, but it will be directly inside the one-pixel-thick dark gray inside border of the frame (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are all the same dark color and this area is approximately relatively smaller than the Game Boy screen area by the right amount (160:144 -> 128:112).

5. Perform some corrections on the Game Boy Camera picture area. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Camera picture area into a proper rectangle with the 128:112 proportions. Make sure to account for perspective distortion as mentioned above.

6. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels. It may be that pixels toward the center of the area are more representative of the true original color due to the pixel bleeding.

7. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels.

8. Save the file as a png.

Make sure to add a command-line argument to print debug logs to investigate problems and respond to feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

An example of a Game Boy Camera picture with very clear edges is `20260216_130838~2.jpg`. An example with unclear edges is `20260216_130909~2.jpg`.

For some examples of what steps along the way might look like, attached are some edited versions of `20260216_131047~2.jpg`:

- `04 Prison Alpha Channel Removed.png` is `20260216_131047~2.jpg` with the Game Boy screen transformed to be a 160:144 rectangle and cropped to size. You can see the 16-pixel-thick frame is around the edges, and the Game Boy Camera picture is 128:112 in the center.

## Add unit test

The transformed `20260216_130838~2.jpg` is still not quite correct. Attached is `20260216_130838~2_gbcam-corrected.png`, a hand-corrected perfect transformation of `20260216_130838~2.jpg`. Write a unit test that performs the transformation on `20260216_130838~2.jpg` and checks it against `20260216_130838~2_gbcam-corrected.png`. There should be lots of helpful output data on what is not correct such as a full list of which pixels are not correct, which color they are, and which color they should be. Make sure running the test provides as much debug and output info as possible in order to have all the information you need to correct the problem. Do not correct the problem yet, though; just write the test and tell me how to run it.

## Run and iterate on unit test

I attached input file `zelda-poster-1.jpg` and reference file `zelda-poster-output-corrected.png`. Run the test on those. Then, analyze the output, consider which steps are contributing to the issues, adjust the code accordingly, and run the test again. Keep running and correcting until you get the output 100% correct.

## Iterate further

Adjust the default auto calculation for the sample margin so it resolves to h=2. When you find a value that works better than default, adjust that to be the new default.

Keep running the test and see what additional adjustments you can make to get higher percent correct. Don't stop until 99.9%

## Iterate with corrected reference image and two poster images

The latest results helped me to find an error in the reference image. This is now corrected. I attached it again as `zelda-poster-output-corrected-2.png`. Also attached are `zelda-poster-1.jpg` and `zelda-poster-2.jpg`. They are both pictures of the same Game Boy Camera picture. Test both of them against the reference image `zelda-poster-output-corrected-2.png` and get them both above 99.95% accurate. Try for 100%.

## Use Down palette instead

I took pictures of the Game Boy Camera screen with a different color palette, and it looks like the colors came out a lot more distinct. The original colors are #FFFFFF, #A5A5A5, #525252, and #000000. The new colors are #FFFFA5, #FF9494, #9494FF, and #000000. They are ordered lightest to darkest:

#FFFFFF -> #FFFFA5

#A5A5A5 -> #FF9494

#525252 -> #9494FF

#000000 -> #000000

These new colors are much more distinct from one another, so it is easier to see which color each pixel is. Note that each pixel on the Game Boy Advance SP screen (TN LCD display) has subpixels with blue on the left, green in the middle, and red on the right. Also note that the frontlight washes the screen out to be quite blue.

Adjust the algorithm so it expects the pictures to have these new colors instead of the old grayscale ones. Do the color corrections on the color image so the frame is primarily #FFFFA5 and the pixel-thick inner edge of the frame is #9494FF. Quantize the colors expecting these four colors as the input. Then output the image in these colors and in the old grayscale colors.

Try adjusting or removing some of the algorithm's logic like the neighboring pixel detection since those may not be as applicable with the new RGB-based approach.

Run the tests with the newly attached `zelda-poster-1.jpg` and `zelda-poster-2.jpg` with `zelda-poster-output-corrected.png` as the reference image. And run the tests with the new attached `thing-1.jpg` and `thing-2.jpg` with `thing-output-corrected.png` as the reference image. Note that these reference images use the grayscale color palette, not the RGB color palette. Feel free to add a step in the test that transforms their colors to the RBG color palette if desired for accurate comparison.

## Refine Down palette use

There are many debug images that seem to indicate you're still doing calculations on the grayscale images. I want you to change the algorithms so the entire process uses the new colors (until you output an image with the grayscale color palette. But I still want an image with the new color palette too).

The rectangular frame around the Game Boy Camera picture should be #FFFFA5. The single-pixel-thick border around the Game Boy Camera picture should be #9494FF. The Game Boy Camera picture and the frame only use the following four colors:

#FFFFA5

#FF9494

#9494FF

#000000

After correcting the light/dark spots on the image, you should be able to correct the color so the frame is flat #FFFFA5 by calculating the right color transformation based on what the color in the frame is vs what it should be (#FFFFA5).

After doing all the color corrections, the image should be pretty easy to figure out each color. You need to group the pixels into the four colors based on which color they're closest to. Each pixel on the Game Boy Advance SP screen (which is a TN LCD display) has subpixel lights with blue on the left, green in the middle, and red on the right. You may notice various parts of the SP pixels are dark based on these sub-pixel colors. For example, a red pixel will be aligned more to the right side of the pixel, whereas a yellow pixel will be aligned more toward the middle of the pixel. You may need to account for the differing areas of color showing per pixel based on this pattern to find the right color for that pixel.

## Try HSL with down palette

There are still many very obviously wrong pixels for example in `zelda-poster-1`. Forget about the test -2 images; focus on the -1 images. Keep improving. It's better to avoid using color smoothing because that uses approximations rather than the actual colors in the image. Have you tried using HSL-based color detection? The hues of the non-black pixels may be obviously close to one of the three possible source hues (or their hues may be clustered closely to one another in a distinguishable way), and the black pixels will likely be significantly darker than the other pixels.

# Prompt Plan -> Act Frame 02 Grayscale Cropped Refined

```

Make a plan to implement the script mentioned in the pasted attached text. Inspect the attached files and consider how they relate to the problem. Make sure to carefully consider the entire problem and effective image manipulation steps and solutions. Break the problem down into steps that you can implement and chain together to make the final product.

```

Write a script that transforms a phone picture taken of a Game Boy Camera Image on a Game Boy Advance SP screen into a 128x112 image of the actual Game Boy Camera image.

The phone picture will be roughly taken and will not consist _only_ of the screen but will simply have the screen in it. The phone picture is cropped so it just has the Game Boy screen with some dark areas around it from the Game Boy Advance SP screen. The screen itself around the Game Boy Camera picture will be dark (not black because the front light is on which washes out the colors) on the outside. Around the Game Boy picture, there will be a white-ish rectangular frame with black dashes around the middle of the frame that measures 160x144. The inner edge of the frame will consist of a one-screen-pixel border in the second darkest color (originally #525252 but will be washed out). The Game Boy Camera picture will be a 128x112 image (in SP pixels, not in image pixels) displayed in four colors:

#FFFFFF

#A5A5A5

#525252

#000000

Because this picture is a rough phone picture of a Game Boy Advance SP screen, there are some implications on the quality of the image:

- Perspective distortion - the phone picture is not perfectly aligned with the Game Boy Advance SP screen and will not be taken perfectly straight-on. The Game Boy Camera picture will not be perfectly rectangular and may not be straight up-and-down. There will be lens distortion as well.
- Pixel bleeding - though there are tiny gaps between pixels on the screen as mentioned below, this picture-of-a-picture method causes some of the brighter pixels on the SP screen to bleed over into the dimmer pixels around them. This pixel bleeding is especially significant vertically; in the lighter areas, it looks like there are columns of nearly uninterrupted color, whereas the gaps between pixels are still somewhat noticeable horizontally even in lighter areas.

The Game Boy Advance SP screen is front-lit and rather old technologically, which has some implications on the quality of the image:

- Significantly washed out colors
- Unevenly distorted colors - the front light brightens the screen unevenly. There are distinct horizontal lines on the dark part of the screen around the Game Boy Camera image that indicate how much each row of screen pixels is unevenly brightened relative to the rest of the screen. Additionally, there may be some very slightly darker or lighter areas on the screen.
- Gaps between pixels - there are tiny gaps between the pixels on the screen. These gaps are especially noticeable side-to-side in that there are vertical lines between most pixel columns that are visually darker than the columns of actual pixels next to them. These gaps are also somewhat noticeable up-and-down in darker areas in that there are some horizontal lines that are noticeable especially in darker areas. These horizontal lines are especially noticeable on the dark parts on the sides of the screen around the Game Boy Camera image. However, on the Game Boy Camera image, especially in the lighter areas, most of the horizontal lines and some the vertical lines are not particularly noticeable because of the screen pixel bleeding mentioned above

The phone picture will contain the following (first is outermost, last is innermost):

1. Dark outside areas of the Game Boy Advance SP screen (will have lots of uneven darkness as mentioned above). In the middle of this area, there is the following:
2. The Game Boy Screen which is 160x144 SP pixels large. This Game Boy Screen has a 16-pixel-thick frame on each side. There is a 15-pixel-wide white area and a one-pixel-thick inside border which is the second-to-darkest color #525252. The white frame has black dashes running through it on each side. There are 17 horizontal black dashes along the top and bottom approximately in the middle of the white frame (5 pixels in from the outer edge), and there are 14 horizontal black dashes along the sides that are close to the outer edges of the white frame (1 pixel in from the outer edge). The dashes are approximately two pixels thick. The corner dashes are fused. Attached is a 160x144 image called `Frame 02.png` which is the exact frame as it is displayed on the Game Boy Screen. Directly inside the frame, there is the following:
3. The Game Boy Camera picture which is 128x112 SP pixels large. In attached `Frame 02.png`, inside the frame is transparent. That is the equivalent of this Game Boy Camera picture region. This is the region you need to capture; everything outside this region may serve as context to help you to determine the right area the Game Boy Camera picture is in.

Attached is `frame_ascii.txt`, which is a 1-to-1 translation of the Game Boy Camera frame into ascii art for ease of analysis and comparison. It uses the following characters to represent the colors:

#FFFFFF -> ` `

#A5A5A5 -> `·`

#525252 -> `▓`

#000000 -> `█`

The script needs to do the following:

1. Accept the input file(s) (drag image(s) onto the script to run it, run via command-line arguments, accept path inputs, etc.) or directory containing the files to transform

2. Find the area in the input file that represents the Game Boy screen (160:144 proportions). See the description of the contents of the Game Boy Advance SP screen above for information about how to find the right area. This area should contain the white frame with black dashes. Make sure to consider perspective distortion as mentioned above; the area will not be a rectangle, but it will have the features mentioned in the Game Boy screen like the white frame with black dashes (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are dark and the edge-most pixels inside the area are very light (because the frame is white)

3. Perform some corrections on the Game Boy Screen area. You will likely benefit from using some of the context around the Game Boy Camera picture area to aid in making these corrections. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Screen area into a proper rectangle with the 160:144 proportions. Make sure to account for perspective distortion as mentioned above to transform the perspective-warped screen into a rectangle.
   - Color correct the issues mentioned above like significantly washed out colors, unevenly distorted colors. The frame is supposed to be all flat white. So you can tell which areas are inappropriately lightened or darkened based on the colors on the frame. Note that you will need to account for the dashes being in the frame; it's not all white. You need to color correct both rows and columns.
   - Check your work by determining if the edges of the area are very light (because the frame is white) and if the black dashed lines in the frame are exactly straight. The ones on the left and right side of the image should be vertical, and the ones on the top and bottom of the image should be horizontal.

4. Find the area in the Game Boy screen area that represents the Game Boy Camera picture area (128:112 proportions). See the description of the contents of the Game Boy Camera picture above for information about how to find the right area. This area should be one "pixel" in from the dark gray inside border of the frame. Make sure to check for perspective distortion again as mentioned above; the area will possibly not be a rectangle, but it will be directly inside the one-pixel-thick dark gray inside border of the frame (as seen in attached `Frame 02.png`).
   - Check your work by determining if the pixels directly outside the area selected are all the same dark color and this area is approximately relatively smaller than the Game Boy screen area by the right amount (160:144 -> 128:112).

5. Perform some corrections on the Game Boy Camera picture area. These corrections may be performed in whatever order makes most sense:
   - Transform the Game Boy Camera picture area into a proper rectangle with the 128:112 proportions. Make sure to account for perspective distortion as mentioned above.

6. For each pixel of the output 128x112 result, determine which input pixel(s) represent that output pixel. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels. It may be that pixels toward the center of the area are more representative of the true original color due to the pixel bleeding.

7. Create the final 128x112 image by determining which of the 2-bit colors each group of input pixels represents. Make sure to account for the pixel bleeding and gaps between pixels as mentioned above. For example, it might be rather challenging to see a darker pixel between two lighter pixels.

8. Save the file as a png.

Make sure to add a command-line argument to print debug logs to investigate problems and respond to feedback on the runs including the output.

Attached are some examples of the input files (phone pictures) that have the Game Boy Camera picture in them. There are some Game Boy Camera pictures that have very clear and distinct edges, and there are some Game Boy Camera pictures that have lots of darkness around the edges. You can use the pictures with clearer edges to calibrate the Game Boy Camera picture area detection.

An example of a Game Boy Camera picture with very clear edges is `20260216_130838~2.jpg`. An example with unclear edges is `20260216_130909~2.jpg`.

For some examples of what steps along the way might look like, attached are some edited versions of `20260216_131047~2.jpg`:

- `04 Prison Alpha Channel Removed.png` is `20260216_131047~2.jpg` with the Game Boy screen transformed to be a 160:144 rectangle and cropped to size. You can see the 16-pixel-thick frame is around the edges, and the Game Boy Camera picture is 128:112 in the center.

Once you have made the script, split up the script into steps so there is an overall script that accepts the command-line args, collects the source images, runs the step scripts, then outputs the transformed images to be input into the next step script. I want to be able to run the overall script and tell it which step in the process to start on (in this case, the input images will be the output from the previous step), then it finishes the process. Make sure the steps are referred to by names, not just step numbers.

Add command-line help -h and --help that explains the overall process including each step in order. Each step should include a description of what it does.

# Prompt Plan -> Act Frame 02 Down Cropped Refined

```

Make a plan to implement the Game Boy Camera picture extraction script mentioned in the attached `prompt.md`. Inspect the attached files and consider how they relate to the problem. Make sure to carefully consider the entire problem and effective image manipulation steps and solutions. Break the problem down into steps that you can implement and chain together to make the final product. Then implement the solution. Keep improving until you get over 99.95% accuracy on all test images. Try for 100%.

```

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

# Recent work on website and TypeScript improvements

/brainstorming The python pipeline is _significantly_ more accurate than the typescript pipeline. Something must have gone wrong in the porting effort. Make a plan to go back and revise the typescript port code to more accurately mirror the python code. Compare the debug output between the typescript and python code to check your work. It may be helpful to write a script that can interweave python and typescript steps then analyze the output so you can isolate individual typescript steps

/brainstorming make a plan to implement the following:

- script that runs a local test of the built website files (simulate GitHub Pages locally - want to be able to test PWA, offline, etc)
- in the website:
  - rewrite the palette colors (`palettes.ts`) to be derived directly from the color tables (`supporting-materials\color-tables`). there are some additional palettes in there that aren't from those color tables; move them into a new "Fun" section instead of mixing it with the others
  - show some indication of progress when processing the images - right now, it just shows you how many are done but doesn't indicate how many there are total or how far along the images are in processing
  - while the user is updating their custom color palette, show the images with the custom palette immediately in the previews. Save their color palette as a draft while they're editing so they can refresh the page or change to other palettes and still have the same draft color palette. Show an indication that the custom palette is a draft. Allow the user to delete their draft custom palette.
    - when there is not a draft custom palette, when the user clicks a color palette, set the new custom color palette to have those colors so the user can easily modify an existing palette. When there is a draft custom palette, don't change it when the user changes palettes
  - add a share button to the images

Investigate the following issues and create a plan for implementing:

- The progress bar is very unhelpful now. It just shows 100% on an image. It needs to show the overall progress for all images in the pipeline
- Put the palette name in the file name with underscores instead of spaces
- Instead of tracking a draft palette, just make the +Custom button create a new user palette in "edit mode" with colors based on the currently selected palette and with name based on the currently selected palette name (e.g. if the palette selected is `0x01`, the starting title should be `0x01 custom #` where `#` is a number that makes the title unique - starting at 1 and increasing until it finds a number that makes the title unique). Now, user palettes should be able to be in "edit mode"
  - Any number of user palettes can be in edit mode at once
  - In "edit mode", the user can set the palette's colors and name (just like it is now when the user is in the process of creating a palette)
  - In "edit mode", clicking in the blank space in the palette selects the palette (meaning the files change to that palette)
  - In "edit mode", the save button should be grayed out and there should be a short description of the problem if the palette name is blank or if the palette name is the same as an existing palette's name
  - In "edit mode", when the palette has previously been saved, there is a cancel button that closes the palette without saving and restores its previously saved values. This means you will have to track the current values and the saved values. But if a palette in edit mode is selected, it should use the current colors, not the saved colors
  - In "edit mode", clicking the save button closes edit mode
  - In "edit mode", there is a delete button that permanently deletes the palette
  - When not in "edit mode", the user palette should have an edit button instead of the current X button that deletes it. There should not be a delete button on the user palettes when they are not in edit mode
- Change the palette generation so the name of the palettes with a button combo do not contain the button combo (e.g. instead of "0x1A (B + Down)" it should just be "0x1A")
- Move the palette generation to gbcam-extract's build step and export the generated palettes from that package. Import it from `gbcam-extract` in `palettes.ts`.

Make a plan to fix the following problems with palette edit mode. Write that plan to a markdown file in repo root. Then commit. Then implement the plan:

- There should not be an X button on Palette swatches.
- You should not be able to edit built-in palettes. They should not have an edit button.
- Palette editing needs work
  - Instead of tracking a draft palette, make the +Custom button create a new user palette in "edit mode" with colors based on the currently selected palette and with name based on the currently selected palette name (e.g. if the palette selected is `0x01`, the starting title should be `0x01 custom #` where `#` is a number that makes the title unique - starting at 1 and increasing until it finds a number that makes the title unique).
  - Any number of user palettes should be able to be in edit mode at once
  - The palettes in edit mode should show up at the top of the user palettes section instead of above it. Don't show the palette swatch if the palette is in edit mode because it is already represented by the edit mode palette.
  - If a palette in edit mode is selected, its background should be brighter blue like the palette swatch. It should also have somewhat brighter blue if its colors match the selected color but it isn't selected.
  - The "+ Custom" button should no longer switch to a "Cancel" button because "+ Custom" should now just create a new user palette in edit mode immediately. No more draft palette
  - In "edit mode", the save button should be grayed out and there should be a short description of the problem if the palette name is blank or if the palette name is the same as an existing palette's name
  - In "edit mode", when the palette has previously been saved, there should be a cancel button that closes the palette without saving and restores its previously saved values. This means you will have to track the current values and the saved values. But if a palette in edit mode is selected, it should use the current colors, not the saved colors. Make sure all of this data is tracked so it does not get lost on refreshing the page
  - In "edit mode", make it so clicking the save button closes edit mode and shows the palette swatch in the list again
  - In "edit mode", there is a delete button that permanently deletes the palette
  - In "edit mode", clicking in the blank space in the palette editor should select the palette (meaning the files change to that palette). When a palette editor is selected, changing the colors in that palette should immediately change the palette colors in the pictures.
- Delete the unused palette generation code in `gbcam-extract-web`
- Remove `palettes.ts` from `gbcam-extract`; instead, just export directly from `palettes-generated.ts`
- Write tests for gbcam-extract's `generate-palettes.ts`

Think deeply. Do not skip any parts of this list; make sure everything is represented in the implementation plan and gets implemented.

---

Make a plan to fix the following problems and implement the following features. Write that plan to a markdown file in repo root. Then commit. Then implement the plan. Commit between groups of features/fixes (e.g. do all the editing palette stuff in one commit, do the image history in another, etc.):

- when you create a new palette whose name matches an existing palette's name, ` custom 1` always gets appended to the end of the string, which is wrong; this means creating new palettes from existing custom palettes will keep adding that string e.g. `0x01 custom 1 custom 1 custom 1 custom 1`. Instead, you need to check if ` custom #` is already at the end of the name. If so, don't append `custom #` again; just increment the number to the first unique number. E.g. creating a new palette based on `0x01 custom 1` should make `0x01 custom 2`
- when you click + Custom, select the new palette.
- make the edit palette text lighter (it doesn't contrast well enough against the blue background). Probably best to just match the colors between the normal palette swatch and the editing palettes. Consider sharing code between these so updating these things just has to happen in one place
- When you click a user palette, it doesn't give it the bright blue and outline like it's selected
- seems like there are a number of issues around an edit palette not being the same as the user palette. Are you copying the data out and not replacing it? Would be best to just mark a user palette as being edited or not edited and just filter the two lists so there is continuity between the palettes
  - when you have an edit palette selected then cancel, the selection needs to return to that edit palette in the user palettes list
  - the editing palette states don't seem to be right. Looks like the last selected edited palette stays selected even if you select a normal palette, but there needs to just be one palette selected at any time. Also, the editing palettes don't have the semi-selected state when their colors match but they aren't the selected palette
  - When you select an edit palette and change its colors, the images don't update with the new selected colors. Changing the palette colors should **immediately** update the image colors.
- the progress bar's reporting is really off. When I provide 2 images, it shows -10% while processing the first image, then shows 40% on the second. When I provide one image, it shows -20%. Something is going wrong. Revise
- keep the palette section showing even when the user hasn't added any images. Save the state of the palette section in localStorage so whether the folded sections are open or closed persists between refreshes
- persist the output images (localStorage? something else?) so they stay between refreshes. Don't store debug images or source images (that's too much data); just keep the output data.
- Every time new images get run, move the previous output images to a foldable "Image History" section (default folded; persist whether it is folded) below the current round's output images.
  - Add a delete button in the top right of each result card and a "Delete all images in history" button at the top of the "Image History" section.
  - Add a way to choose how many images are saved in history before old ones are deleted (default 10). Persist this setting
  - persist the image history so they stay between refreshes as well. But automatically delete the oldest images when they are more than the configured number of images to save in history

Think deeply. Do not skip any parts of this list; make sure everything is represented in the implementation plan and gets implemented.

---

- When I have generated images and reload the page with `gbcam-current-results` populated with two images, I get the following error, and nothing loads. Fix this error, and make sure it is also not going to come up in image history either:

```
Uncaught InvalidStateError: Failed to construct 'ImageData': The input data has zero elements.
at ResultCard.tsx:47:21
```

- The new custom palette names are still wrong - if "custom #" is at the end of the name you're copying from, you need to make the new name increment the existing number instead of just having the same name as the existing one
- For an editing palette, the somewhat blue background color that shows when the palette has matching colors to the selected palette but is not actually the selected palette is not working. It just has the normal gray background if it is not selected. Fix this so matching colors but not matching name has the same blue styling as the palette swatch
- If you click "+ Custom" twice on the same selection to add two custom palettes that are in editing mode, they receive different names (different number at the end). But when you try to save one, the other displays "A palette with this name already exists". Fix this
- Looks like palette editing validation errors like name already exists don't show up unless you select the palette. Make it so the editing errors display whether or not you select the palette

---

- Add a new feature: copy palette to clipboard in the editing palette UI, paste pa
  Copy palette to clipboard, paste new palette, paste palette colors in editing palette
  offline, "install PWA". Seemed like OpenCV wasn't loading offline or something - the upload buttons were grayed out
  The offline-available features don't seem to be working properly. It seems I can "add to home screen", but I can't "install website" as a PWA for offline use. When I connect offline, it doesn't work. Diagnose the problem and fix it.
  Additionally, when I stop and start the preview, my browser doesn't update the files. Instead of not even checking if there are changes, can you make it so it checks a hash of the files to import and only downloads the new files if there are changes?
  Download all zipped button
  Keep old output files
  Not touching frame_ascii.txt in correct.ts - why?
  Change the algorithm so it detects an appropriate scale instead of using 8 hard-coded
  Edit custom palettes
  Favorite palettes
  Figure out why bots can't run pnpm from Volta, write how to run it in AGENTS.md, redo emphasis on how to run stuff
  Move md files etc. from py into right places
  Update instructions files
  Scale output images to preferred scale
  Remove http-server? Maybe vite preview does everything
  Localization
