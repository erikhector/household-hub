import { describe, expect, it } from "vitest";
import { normalizeVoiceTranscript, speechRecognitionLang } from "./voice-transcript";
import { parseSmartAddInput } from "./smart-add-suggestions";

describe("speechRecognitionLang", () => {
  it("maps the app locale to a recognizer language tag", () => {
    expect(speechRecognitionLang("sv")).toBe("sv-SE");
    expect(speechRecognitionLang("en")).toBe("en-US");
  });
});

describe("normalizeVoiceTranscript (English)", () => {
  const en = (text: string) => normalizeVoiceTranscript(text, "en");

  it("turns the design brief's example into the typed equivalent", () => {
    expect(en("two liters of milk and eggs")).toBe("2 l milk, eggs");
    expect(parseSmartAddInput(en("Two liters of milk and eggs"))).toEqual([
      { name: "milk", quantity: 2, unit: "l" },
      { name: "eggs", quantity: 1 },
    ]);
  });

  it("reads single, compound and hyphenated number words", () => {
    expect(en("six eggs")).toBe("6 eggs");
    expect(en("twelve rolls")).toBe("12 rolls");
    expect(en("twenty four cans of beer")).toBe("24 cans beer");
    expect(en("twenty-four cans of beer")).toBe("24 cans beer");
    expect(en("thirty eggs")).toBe("30 eggs");
  });

  it("treats a leading article as one, but never a lone article", () => {
    expect(en("a bag of rice")).toBe("1 bag rice");
    expect(en("an avocado")).toBe("1 avocado");
    expect(en("a")).toBe("a");
  });

  it("reads a dozen as twelve", () => {
    expect(en("a dozen eggs")).toBe("12 eggs");
    expect(en("one dozen eggs")).toBe("12 eggs");
  });

  it("maps spoken units after digits too, as recognizers often emit digits", () => {
    expect(en("2 kilos of potatoes")).toBe("2 kg potatoes");
    expect(en("500 grams minced meat")).toBe("500 g minced meat");
  });

  it("keeps number words inside a name alone", () => {
    expect(en("pasta with ten herbs")).toBe("pasta with ten herbs");
  });

  it("reads a trailing count before a unit", () => {
    expect(parseSmartAddInput(en("milk two liters"))).toEqual([{ name: "milk", quantity: 2, unit: "l" }]);
  });

  it("splits on commas and 'and', and drops recognizer punctuation", () => {
    expect(en("Milk, bread and three bananas.")).toBe("Milk, bread, 3 bananas");
  });

  it("returns an empty string for an empty transcript", () => {
    expect(en("   ")).toBe("");
  });
});

describe("normalizeVoiceTranscript (Swedish)", () => {
  const sv = (text: string) => normalizeVoiceTranscript(text, "sv");

  it("reads Swedish number words, including en/ett", () => {
    expect(sv("två liter mjölk och ägg")).toBe("2 l mjölk, ägg");
    expect(sv("en gurka")).toBe("1 gurka");
    expect(sv("ett paket smör")).toBe("1 paket smör");
    expect(sv("tre burkar krossade tomater")).toBe("3 burkar krossade tomater");
  });

  it("reads written-together and spaced compounds", () => {
    expect(sv("tjugofyra ägg")).toBe("24 ägg");
    expect(sv("tjugoett ägg")).toBe("21 ägg");
    expect(sv("tjugo fyra ägg")).toBe("24 ägg");
  });

  it("reads ett dussin as twelve", () => {
    expect(sv("ett dussin ägg")).toBe("12 ägg");
  });

  it("maps Swedish unit words and drops 'av'", () => {
    expect(sv("ett kilo av potatis")).toBe("1 kg potatis");
    expect(sv("fem hekto köttfärs")).toBe("5 hg köttfärs");
    expect(sv("sex stycken ägg")).toBe("6 st ägg");
  });

  it("splits on 'och' and parses end-to-end", () => {
    expect(parseSmartAddInput(sv("två liter mjölk och bröd och sex ägg"))).toEqual([
      { name: "mjölk", quantity: 2, unit: "l" },
      { name: "bröd", quantity: 1 },
      { name: "ägg", quantity: 6 },
    ]);
  });

  it("doesn't read English number words in Swedish", () => {
    expect(sv("two eggs")).toBe("two eggs");
  });
});
