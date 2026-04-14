export async function canShare(): Promise<boolean> {
  if (!("share" in navigator)) return false;

  // Check if canShare API is available
  if ("canShare" in navigator) {
    try {
      // Try to check if we can share files
      const testFile = new File([""], "test.png", { type: "image/png" });
      const canShareFiles = (navigator as any).canShare({ files: [testFile] });
      if (canShareFiles) return true;

      // If file sharing is not supported, try text sharing as fallback
      // Some browsers support share() but not file sharing specifically
      const canShareText = (navigator as any).canShare({ title: "test" });
      return canShareText;
    } catch {
      // If canShare check fails, fall back to testing with the actual share API
      // This is a more permissive approach for browsers with incomplete API support
      return true;
    }
  }

  // If canShare API is absent but share is present, assume it works
  // Modern mobile browsers should have both, but be permissive for compatibility
  return true;
}

export async function shareImage(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  if (!("share" in navigator)) {
    throw new Error("Web Share API not supported");
  }

  try {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob from canvas"));
          return;
        }

        try {
          await navigator.share({
            files: [new File([blob], filename, { type: "image/png" })],
            title: "Game Boy Camera Picture",
          });
          resolve();
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            reject(err);
          } else {
            // User cancelled share - this is normal, don't throw
            resolve();
          }
        }
      }, "image/png");
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      throw err;
    }
    // User cancelled share - this is normal, don't throw
  }
}

export async function copyImageToClipboard(
  canvas: HTMLCanvasElement,
): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Failed to create blob from canvas"));
        return;
      }

      try {
        // Check if clipboard API is available
        if (!navigator.clipboard) {
          reject(new Error("Clipboard API not available"));
          return;
        }

        const item = new ClipboardItem({
          "image/png": blob,
        });

        try {
          await navigator.clipboard.write([item]);
          resolve();
        } catch (err) {
          // Handle permission denied and other errors
          const errorName = (err as Error).name;
          if (errorName === "NotAllowedError") {
            reject(
              new Error(
                "Clipboard permission denied. Please allow clipboard access in your browser settings.",
              ),
            );
          } else if (errorName === "SecurityError") {
            reject(
              new Error(
                "Security error: clipboard access not allowed in this context",
              ),
            );
          } else {
            reject(err);
          }
        }
      } catch (err) {
        reject(err);
      }
    }, "image/png");
  });
}
