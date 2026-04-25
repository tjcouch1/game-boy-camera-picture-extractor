# Inner Border Validation Enhancements - March 24, 2025

## New Diagnostic: `_validate_inner_border()`

A detailed validation function that checks the precise positioning and integrity of the inner #9494FF border after perspective correction.

### What It Checks

#### 1. **Corner Position Accuracy**
For each of the four corners (TL, TR, BL, BR):
- **Expected position**: 16 pixels from each edge (INNER_LEFT, INNER_TOP, etc.)
- **Detected position**: Scans for actual blue (#9494FF) pixels near expected location
- **Error measurement**: Reports pixel offset from expected position
- **Output format**: `TL: expected=(120,120) detected=(119,120) error=(+1,+0.0) pixels`

The function samples a ±4-pixel margin around each expected corner and searches for blue border pixels to find the actual corner position.

#### 2. **Edge Straightness**
For each of the four edges (top, bottom, left, right):
- **Range**: Reports which pixel columns/rows contain the blue border
- **Variance**: Measures how straight the edge is (lower is straighter)
- **Output**: Shows the pixel range the edge spans and statistical variance

This validates that edges aren't tilted or bent after perspective correction.

#### 3. **Color Verification**
Checks that:
- Border pixels are actually blue (#9494FF = RGB 148,148,255)
- Frame pixels outside border are yellow (#FFFFA5 = RGB 255,165,165)
- Uses 30-point threshold for matching (some color variation from compression/light)

### When It Runs

1. **Pass 0 (Initial warp)**: Baseline measurement before refinement
2. **Pass 1**: After first refinement iteration
3. **Pass 2**: After second refinement iteration

This progression shows how much each refinement pass improves the corner positions.

### Example Output

```
  Initial border validation:
    TL: expected=(120,120) detected=(119,121) error=(−1,+1) pixels
    TR: expected=(1152,120) detected=(1152,121) error=(+0,+1) pixels
    BL: expected=(120,1024) detected=(121,1023) error=(+1,−1) pixels
    BR: expected=(1152,1024) detected=(1152,1024) error=(+0,−0) pixels
    top edge straight: {'range': (119, 1152), 'variance': 2.34}
    bottom edge straight: {'range': (119, 1151), 'variance': 1.87}
    left edge straight: {'range': (120, 1024), 'variance': 0.56}
    right edge straight: {'range': (121, 1023), 'variance': 1.23}

  Pass 1 inner border validation:
    TL: expected=(120,120) detected=(120,120) error=(+0,+0) pixels
    TR: expected=(1152,120) detected=(1152,120) error=(+0,+0) pixels
    BL: expected=(120,1024) detected=(120,1024) error=(+0,+0) pixels
    BR: expected=(1152,1024) detected=(1152,1024) error=(+0,+0) pixels
    ...
```

### How to Interpret Results

**Good results:**
- All corner errors ±1 pixel or less
- All edge variances < 2.0
- Progression shows errors decreasing from Pass 0 → 1 → 2

**Problem indicators:**
- One corner has significantly larger error than others → residual perspective distortion
- Edge variance > 5 → edge is tilted or wavy
- Errors not improving between passes → refinement algorithm needs adjustment

### For zelda-poster-3 Specifically

Based on your observations:
- Top-left: ~1/4 pixel too far left (error ~−0.25, 0)
- Top-right: ~1/4 pixel too far right, 1/8 too low (error ~+0.25, −0.125)
- Bottom-left: ~1/6 too far left, 1/2 too high (error ~−0.167, −0.5)
- Bottom-right: pretty much spot on (error ~0, 0)

The detailed validation should show these sub-pixel errors clearly and help identify if additional refinement passes or algorithm tuning is needed.

### Integration with Existing Diagnostics

Works alongside the frame edge verification to provide complete picture:
- `_verify_dash_positions()`: Checks outer frame (#FFFFA5) color
- `_validate_inner_border()`: Checks inner border (#9494FF) position and color
- Together they validate the entire transform: frame corners → inner border corners → camera image area

### Next Steps for Fine-Tuning

With these diagnostics, you can:
1. Run tests and observe corner error patterns
2. Identify which corners consistently misalign
3. Consider per-corner refinement strategies if patterns emerge
4. Possibly extend to 3+ refinement passes for particularly difficult images
5. Adjust detection band sizes if certain corners are systematically off
