# Fix: localStorage Loading Race Condition

## Problem
When the page reloaded, the async deserialization from PNG format wasn't completing before the first useEffect for saving ran. This caused:
1. `setResults([])` on initial render
2. Async loading starts but hasn't completed
3. Save effect runs with empty results
4. `saveResultsToStorage([])` overwrites the actual data in localStorage
5. Even when loading completes, the data is already lost

## Root Cause
The save effect ran immediately after state initialization, before the async load completed:

```javascript
// WRONG - save effect runs too soon
useEffect(() => {
  saveResultsToStorage(results);  // Runs with [] before async load finishes
}, [results]);
```

## Solution
Implement a **load-first, save-later** pattern:

### Key Changes

1. **Add `isLoaded` state flag:**
   ```typescript
   const [isLoaded, setIsLoaded] = useState(false);
   ```

2. **Load data on mount before saving:**
   ```typescript
   useEffect(() => {
     let isMounted = true;
     loadResultsFromStorage()
       .then((loaded) => {
         if (isMounted) {
           setResults(loaded);      // Set results first
           setIsLoaded(true);        // Mark as loaded
           saveResultsToStorage(loaded);  // Confirm save
         }
       })
       .catch(() => {
         // If loading fails, clear storage
         if (isMounted) {
           setResults([]);
           setIsLoaded(true);
           localStorage.removeItem(RESULTS_STORAGE_KEY);
         }
       });
     return () => { isMounted = false; };
   }, []);
   ```

3. **Only save after initial load:**
   ```typescript
   useEffect(() => {
     if (isLoaded) {  // Only save AFTER async load completes
       saveResultsToStorage(results);
     }
   }, [results, isLoaded]);
   ```

### Applied to Both
- `useProcessing.ts` — Current results loading
- `useImageHistory.ts` — Image history loading

## Benefits

✅ **Async loading completes before first save**
✅ **PNG deserialization has time to finish**
✅ **Fallback handling if loading fails** (clears corrupted storage)
✅ **Confirmation save** ensures consistency
✅ **No data loss** on page reload
✅ **Works for both current results and history**

## Sequence (After Fix)

```
1. Page loads, useState initializes to []
2. isLoaded = false → save effect doesn't run
3. useEffect starts async load
4. PNG data deserializes from localStorage
5. setResults(loaded) → results updated
6. setIsLoaded(true) → enables save effect
7. saveResultsToStorage(loaded) → confirms data in localStorage
8. Any future result changes also save (isLoaded = true)
```

## Test Case
1. Open app, load images → saved to localStorage as PNG
2. Reload page
3. Images should appear immediately
4. No overwriting with empty array
