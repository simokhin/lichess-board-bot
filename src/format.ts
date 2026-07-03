export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Escapes legacy Telegram Markdown special characters in untrusted text (names, error bodies)
 * before it's interpolated into a message sent with parse_mode: "Markdown". */
export function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}
