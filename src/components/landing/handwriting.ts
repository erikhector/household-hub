import { Caveat } from "next/font/google";

// The landing page's handwriting: the notes on the fridge door and the
// little scribbled asides around the headline and the closing sticky note.
// Loaded here rather than in the root layout so only the landing page pays
// for it; nothing in the app itself is handwritten.
export const handwriting = Caveat({
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});
