function defaultOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

export function absoluteUrl(value: string | null | undefined, origin = defaultOrigin()): string {
  if (!value) return "";
  try {
    const url = new URL(value, origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}
