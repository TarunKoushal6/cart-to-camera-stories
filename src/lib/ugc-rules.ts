export type Source = "amazon" | "flipkart" | "other";

/** Only Amazon and Flipkart product links are accepted. */
export function detectSource(url: string): Source {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (/(^|\.)amazon\.[a-z.]+$/.test(host) || host === "amzn.in" || host === "amzn.to" || host === "a.co") return "amazon";
  if (/(^|\.)flipkart\.com$/.test(host) || host === "fkrt.it" || host === "dl.flipkart.com") return "flipkart";
  return "other";
}
