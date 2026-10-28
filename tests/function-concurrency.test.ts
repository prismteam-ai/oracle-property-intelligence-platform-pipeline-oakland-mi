import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseFunctionConcurrencyOutput } from "../packages/hosted-runtime/src/function-concurrency.ts";

describe("successful Lambda concurrency CLI boundary", () => {
  it("accepts actual successful CLI zero-byte stdout as no reservation", () => {
    const stdout = execFileSync(process.execPath, ["--eval", ""], {
      encoding: "utf8",
    });
    expect(stdout).toBe("");
    const actual = parseFunctionConcurrencyOutput(stdout);
    expect(actual.ReservedConcurrentExecutions ?? null).toBeNull();
  });

  it.each(["", " \n\t", "{}", " { }\n"])(
    "recognizes only absent optional reservation output: %j",
    (stdout) => {
      expect(parseFunctionConcurrencyOutput(stdout)).toEqual({});
    },
  );

  it.each([0, 2, 5, 1000])("preserves configured reservation %i", (count) => {
    const actual = parseFunctionConcurrencyOutput(
      JSON.stringify({ ReservedConcurrentExecutions: count }),
    );
    expect(actual.ReservedConcurrentExecutions).toBe(count);
    // The shared-mode capacity guard must still reject an actual reservation,
    // including zero (which disables function execution), rather than erase it.
    expect(actual.ReservedConcurrentExecutions ?? null).not.toBeNull();
  });

  it.each([
    "{",
    "undefined",
    "null",
    "[]",
    '""',
    "false",
    "0",
    '{"ReservedConcurrentExecutions":null}',
    '{"ReservedConcurrentExecutions":"5"}',
    '{"ReservedConcurrentExecutions":-1}',
    '{"ReservedConcurrentExecutions":0.5}',
    '{"ReservedConcurrentExecutions":9007199254740992}',
    '{"reservedConcurrentExecutions":5}',
    '{"ReservedConcurrentExecutions":5,"unexpected":true}',
  ])("refuses nonempty malformed or unrecognized output: %s", (stdout) => {
    expect(() => parseFunctionConcurrencyOutput(stdout)).toThrow(
      "Lambda concurrency response rejected",
    );
  });

  it("does not turn an actual failed CLI with empty stdout into shared mode", () => {
    let parserCalls = 0;
    expect(() => {
      const stdout = execFileSync(
        process.execPath,
        ["--eval", "process.exit(7)"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      parserCalls++;
      return parseFunctionConcurrencyOutput(stdout);
    }).toThrow();
    expect(parserCalls).toBe(0);
  });
});
