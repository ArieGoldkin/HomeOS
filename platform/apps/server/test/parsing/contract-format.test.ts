import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parsedMessageSchema } from "@homeos/shared";
import { describe, expect, it } from "vitest";

// parsedMessageSchema is BOTH the structured-output format (zodOutputFormat → JSON Schema sent to
// Claude) and the re-validation gate (safeParse). The unit suite mocks rawParse, so nothing else
// exercises the conversion — this guards that the G1/G15 bounds (.max + .regex) stay representable
// and don't break structured outputs at runtime.
describe("parsedMessageSchema as a structured-output format", () => {
  it("converts via zodOutputFormat without throwing", () => {
    expect(() => zodOutputFormat(parsedMessageSchema)).not.toThrow();
  });

  it("carries the length bounds into the generated JSON Schema", () => {
    const json = JSON.stringify(zodOutputFormat(parsedMessageSchema));
    expect(json).toContain("maxLength");
  });
});
