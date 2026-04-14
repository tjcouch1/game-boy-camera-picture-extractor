export function canShare(): boolean {
  // Check if the basic share API exists
  if (!("share" in navigator)) return false;

  // The Share API is available; assume it works for mobile
  // Some browsers don't have canShare API, but share() still works
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
