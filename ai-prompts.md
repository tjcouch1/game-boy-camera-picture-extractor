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
