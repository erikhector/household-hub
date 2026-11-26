import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { DECIMAL_PATTERN } from "@/lib/decimal-input";

/**
 * UX-30: a money or quantity field that takes a decimal comma. A text
 * input with the decimal keypad, not `type="number"`: WebKit submits ""
 * for "12,5" in a number input, and a Swedish-region iPhone's decimal
 * keypad has only ",". `min`/`max`/`step` don't apply to a text input, so
 * every range rule lives in the action's Zod schema; read the value with
 * `parseDecimal` (client) or `normalizeDecimal` (server), never
 * `Number(value)` or `valueAsNumber`. See src/lib/decimal-input.ts.
 */
export function DecimalInput(props: Omit<ComponentProps<typeof Input>, "type" | "min" | "max" | "step" | "pattern">) {
  return <Input type="text" inputMode="decimal" pattern={DECIMAL_PATTERN} autoComplete="off" {...props} />;
}
