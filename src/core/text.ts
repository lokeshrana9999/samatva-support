// Small text helpers shared by the server and the client, so the length cap
// and the language pick mean the same thing on both sides (design D17, D18).
import type { Lang } from "./types";

export function codePoints(text: string): number {
  return Array.from(text).length;
}

// Common roman-Hindi function words. Two or more in a message read as Hinglish.
const HINGLISH_MARKERS = new Set(
  (
    "hai hain hoon hun tha thi mujhe mera meri mere tum tumhe aap aapko kya kyun kaise " +
    "nahi nahin bahut bohot yaar kar karna karta karti raha rahi rahe ho gaya gayi " +
    "kuch sab bhi toh hi aur lekin par pe se ko ka ki ke woh wo yeh ye abhi kal " +
    "samajh pata lagta lag dil ghar baat bata batao chahiye sakta sakti " +
    "main mai mein chahta chahti chahte marna jeena kaam log"
  ).split(" "),
);

export function detectLang(text: string): Lang {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let hits = 0;
  for (const w of words) if (HINGLISH_MARKERS.has(w)) hits++;
  return hits >= 2 ? "hi-Latn" : "en-IN";
}
