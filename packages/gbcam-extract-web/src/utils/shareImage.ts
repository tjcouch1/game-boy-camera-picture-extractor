export async function canShare(): Promise<boolean> {
  return "share" in navigator;
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
        const item = new ClipboardItem({
          "image/png": blob,
        });
        await navigator.clipboard.write([item]);
        resolve();
      } catch (err) {
        reject(err);
      }
    }, "image/png");
  });
}
