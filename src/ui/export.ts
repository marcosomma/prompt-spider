export type Aspect = "16:9" | "1:1" | "4:5" | "9:16";

export const EXPORT_SIZES: Readonly<Record<Aspect, { width: number; height: number }>> = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

export function isAspect(value: string): value is Aspect {
  return value in EXPORT_SIZES;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export function exportFilename(modelId: string, aspect: Aspect): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `prompt-spider_${modelId}_${aspect.replace(":", "x")}_${stamp}.png`;
}

/** Sizes `box` to the largest rectangle of the given aspect that fits inside `area`. */
export function fitAspect(area: HTMLElement, box: HTMLElement, aspect: Aspect): void {
  const { width, height } = EXPORT_SIZES[aspect];
  const ratio = width / height;
  const availableWidth = area.clientWidth;
  const availableHeight = area.clientHeight;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  const fitWidth = Math.min(availableWidth, availableHeight * ratio);
  box.style.width = `${Math.floor(fitWidth)}px`;
  box.style.height = `${Math.floor(fitWidth / ratio)}px`;
}
