export interface StartPageBackgroundImageMetrics {
  height: number;
  width: number;
}

export interface StartPageShellFrame {
  height: number;
  width: number;
}

export interface StartPageSurfaceRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface StartPageSurfaceBackgroundOptions {
  backgroundImage: string;
  fallbackBackground: string;
  imageMetrics?: StartPageBackgroundImageMetrics | null;
  isLight: boolean;
  shellFrame?: StartPageShellFrame | null;
  surfaceRect?: StartPageSurfaceRect | null;
}

interface StartPageSurfaceBackgroundStyle {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundSize: string;
}

const imageMetricsCache = new Map<string, StartPageBackgroundImageMetrics | null>();
const imageMetricsPromiseCache = new Map<string, Promise<StartPageBackgroundImageMetrics | null>>();

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toPixelValue(value: number) {
  return `${Number(value.toFixed(2))}px`;
}

export function getStartPageBackgroundBaseColor(isLight: boolean) {
  return isLight ? "#f8f9fa" : "#04070f";
}

export function getStartPageBackgroundOverlay(isLight: boolean) {
  return isLight
    ? null
    : "linear-gradient(180deg, rgba(4, 7, 15, 0.24), rgba(4, 7, 15, 0.62))";
}

export function buildStartPageSurfaceBackgroundStyle(
  options: StartPageSurfaceBackgroundOptions,
): StartPageSurfaceBackgroundStyle {
  const overlay = getStartPageBackgroundOverlay(options.isLight);
  const backgroundLayers = overlay
    ? [overlay, `url("${options.backgroundImage}")`, options.fallbackBackground]
    : [`url("${options.backgroundImage}")`, options.fallbackBackground];
  const baseStyle = {
    backgroundColor: getStartPageBackgroundBaseColor(options.isLight),
    backgroundImage: backgroundLayers.join(", "),
    backgroundRepeat: backgroundLayers.map(() => "no-repeat").join(", "),
  } satisfies Pick<
    StartPageSurfaceBackgroundStyle,
    "backgroundColor" | "backgroundImage" | "backgroundRepeat"
  >;

  const shellFrame = options.shellFrame;
  const surfaceRect = options.surfaceRect;
  const imageMetrics = options.imageMetrics;
  if (
    !isPositiveNumber(imageMetrics?.width)
    || !isPositiveNumber(imageMetrics?.height)
    || !isPositiveNumber(shellFrame?.width)
    || !isPositiveNumber(shellFrame?.height)
    || !isPositiveNumber(surfaceRect?.width)
    || !isPositiveNumber(surfaceRect?.height)
  ) {
    return {
      ...baseStyle,
      backgroundPosition: overlay
        ? "0 0, center center, center center"
        : "center center, center center",
      backgroundSize: overlay
        ? "100% 100%, cover, cover"
        : "cover, cover",
    };
  }

  const scale = Math.max(
    shellFrame.width / imageMetrics.width,
    shellFrame.height / imageMetrics.height,
  );
  const scaledWidth = Math.max(1, imageMetrics.width * scale);
  const scaledHeight = Math.max(1, imageMetrics.height * scale);
  const offsetX = (shellFrame.width - scaledWidth) / 2 - surfaceRect.x;
  const offsetY = (shellFrame.height - scaledHeight) / 2 - surfaceRect.y;

  return {
    ...baseStyle,
    backgroundPosition: overlay
      ? `0 0, ${toPixelValue(offsetX)} ${toPixelValue(offsetY)}, center center`
      : `${toPixelValue(offsetX)} ${toPixelValue(offsetY)}, center center`,
    backgroundSize: overlay
      ? `100% 100%, ${toPixelValue(scaledWidth)} ${toPixelValue(scaledHeight)}, cover`
      : `${toPixelValue(scaledWidth)} ${toPixelValue(scaledHeight)}, cover`,
  };
}

export function loadStartPageBackgroundImageMetrics(src: string) {
  const normalizedSrc = src.trim();
  if (!normalizedSrc) {
    return Promise.resolve(null);
  }

  const cachedMetrics = imageMetricsCache.get(normalizedSrc);
  if (cachedMetrics !== undefined) {
    return Promise.resolve(cachedMetrics);
  }

  const pendingPromise = imageMetricsPromiseCache.get(normalizedSrc);
  if (pendingPromise) {
    return pendingPromise;
  }

  const nextPromise = new Promise<StartPageBackgroundImageMetrics | null>((resolve) => {
    if (typeof Image === "undefined") {
      imageMetricsCache.set(normalizedSrc, null);
      imageMetricsPromiseCache.delete(normalizedSrc);
      resolve(null);
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const metrics =
        isPositiveNumber(image.naturalWidth) && isPositiveNumber(image.naturalHeight)
          ? {
            height: image.naturalHeight,
            width: image.naturalWidth,
          }
          : null;
      imageMetricsCache.set(normalizedSrc, metrics);
      imageMetricsPromiseCache.delete(normalizedSrc);
      resolve(metrics);
    };
    image.onerror = () => {
      imageMetricsCache.set(normalizedSrc, null);
      imageMetricsPromiseCache.delete(normalizedSrc);
      resolve(null);
    };
    image.src = normalizedSrc;
  });

  imageMetricsPromiseCache.set(normalizedSrc, nextPromise);
  return nextPromise;
}
