#!/usr/bin/env python3
"""Trace right edge detection logic."""

# From gbcam_warp.py _find_border_corners, the _right_x function:
# 
#   def _right_x(r0, r1_):
#       exp_frame = (INNER_RIGHT + 1) * scale
#       c1, c2 = max(0, exp_frame - srch), min(W, exp_frame + srch)
#       prof = channel[r0:r1_, int(c1):int(c2)].mean(axis=0)
#       idx  = _first_dark_from_frame(prof[::-1])
#       return int(c2 - 1) - idx - (scale - 1)
#
# Constants:
# INNER_RIGHT = 143  (GB pixels, where the inner border ENDS)
# scale = 8  (output pixels per GB pixel)
# srch = 6 * scale = 48  (search range)
# 
# So:
# exp_frame = (143 + 1) * 8 = 144 * 8 = 1152
# c1 = 1152 - 48 = 1104
# c2 = min(W, 1152 + 48) = min(W, 1200)
#
# The profile is from c1 to c2 (width = c2 - c1 = 96 pixels if W >= 1200)
# The profile is then REVERSED: prof[::-1]
# _first_dark_from_frame finds the steepest drop in the REVERSED profile
#
# If the steepest drop is at index idx in the reversed profile:
# - idx=0 means the drop is at the start (rightmost pixel c2-1 in original)
# - idx=95 means the drop is at the end (leftmost pixel c1 in original)
#
# The original position of the steepest drop in the original profile is:
# original_idx = (c2 - c1) - idx - 1 = 96 - idx - 1 = 95 - idx
# original_pos = c1 + original_idx = c1 + 95 - idx = 1104 + 95 - idx
#
# But the code does:
# return int(c2 - 1) - idx - (scale - 1)
#      = int(c2 - 1) - idx - 7
#
# If idx = 0 (steepest drop at index 0 of reversed, i.e., rightmost c2-1):
#   return (c2 - 1) - 0 - 7 = 1199 - 0 - 7 = 1192  (8 pixels too far left!)
#
# If idx = 8 (steepest drop at index 8 of reversed):
#   return (c2 - 1) - 8 - 7 = 1199 - 8 - 7 = 1184  (16 pixels too far left!)
#
# The issue is: we want to find the FRAME->BORDER transition, not the BORDER->CONTENT transition.
# In the reversed profile, the white FRAME comes first (high R-B values),
# then drops to blue BORDER (lower R-B values).
#
# _first_dark_from_frame finds the first drop, which IS the frame->border transition in the reversed profile.
# So idx points to the border pixel (the first dark pixel when scanning from frame).
#
# But then we're subtracting (scale - 1) = 7, which moves us 7 pixels FURTHER left from the border.
# This would be correct IF idx pointed to the border center, but it points to the detected border start.

INNER_RIGHT = 143
scale = 8
srch = 6 * scale

exp_frame = (INNER_RIGHT + 1) * scale
c1 = max(0, exp_frame - srch)
c2_max = min(1280, exp_frame + srch)  # Assuming max width is 1280

print(f"Right edge detection logic:")
print(f"  INNER_RIGHT = {INNER_RIGHT}")
print(f"  exp_frame = ({INNER_RIGHT}+1) * {scale} = {exp_frame}")
print(f"  c1 = {exp_frame} - {srch} = {c1}")
print(f"  c2 = {exp_frame} + {srch} = {exp_frame + srch}")
print(f"  Profile width = {c2_max - c1}")
print()
print(f"If _first_dark_from_frame returns idx (index in reversed profile):")
print(f"  Detected position = c2 - 1 - idx - (scale - 1)")
print(f"                    = {c2_max} - 1 - idx - {scale - 1}")
print(f"                    = {c2_max - 1} - idx - {scale - 1}")
print()
print(f"Expected outer border (INNER_RIGHT * scale) = {INNER_RIGHT * scale}")
print()
print(f"For idx = 0 (steepest drop at rightmost pixel):")
print(f"  Detected = {c2_max - 1 - 0 - (scale - 1)} = {c2_max - 1 - (scale - 1)}")
print(f"  Error = {c2_max - 1 - (scale - 1)} - {INNER_RIGHT * scale} = {c2_max - 1 - (scale - 1) - INNER_RIGHT * scale}")
print()
print(f"For idx = 8:")
print(f"  Detected = {c2_max - 1 - 8 - (scale - 1)} = {c2_max - 1 - 8 - (scale - 1)}")
print(f"  Error = {c2_max - 1 - 8 - (scale - 1)} - {INNER_RIGHT * scale} = {c2_max - 1 - 8 - (scale - 1) - INNER_RIGHT * scale}")
print()
print("ISSUE: The subtraction of (scale - 1) is designed to handle the frame->border->content")
print("transition, but the logic may be off by a half pixel or the search window may be")
print("too narrow, causing detection to find the wrong edge.")
