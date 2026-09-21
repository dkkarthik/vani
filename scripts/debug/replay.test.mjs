import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
test("offline replay identifies exact quotation mismatch without inference and refuses overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vani-replay-"));
  try {
    const input = join(dir, "packet.json"),
      output = join(dir, "report.json");
    await writeFile(
      input,
      JSON.stringify({
        id: "fixture",
        packet: {
          input: { paper: { text: "Robots learn from demonstrations." } },
          schema: {},
          instruction: "read",
          task: "d1",
        },
        raw_output: JSON.stringify({
          quote: "This is an invented quotation.",
          contribution: "test",
          likelyRelated: false,
          reason: "test",
          uncertainties: [],
        }),
      }),
    );
    execFileSync(process.execPath, [
      "scripts/debug/replay.mjs",
      "validate",
      input,
      output,
    ]);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.rows[0].baseline.issues[0].code, "quote_mismatch");
    assert.equal(report.rows[0].replay, undefined);
    assert.throws(() =>
      execFileSync(
        process.execPath,
        ["scripts/debug/replay.mjs", "validate", input, output],
        { stdio: "pipe" },
      ),
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          "scripts/debug/replay.mjs",
          "run",
          input,
          join(dir, "bad.json"),
          "--url=https://example.com",
        ],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
