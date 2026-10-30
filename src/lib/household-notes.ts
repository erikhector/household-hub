// GAP-16: shared between notes-actions.ts (the Zod max) and the add-note
// textarea's maxLength, so the limit is visible before submitting. Lives
// here rather than in the actions file because a "use server" module may
// only export async functions.
//
// Long enough for a paragraph ("the plumber's coming Thursday between 8 and
// 12, key's under the mat…") but short enough that one note can't turn the
// board into a document store.
export const NOTE_BODY_MAX_LENGTH = 1000;

// GAP-61: how many notes may be pinned at once. Pins are for lasting facts
// (the wifi code, "allergic to nuts"); uncapped they'd become the feed again.
export const NOTE_PIN_MAX = 5;
