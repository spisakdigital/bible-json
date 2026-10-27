import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorPath = path.join(repositoryRoot, "scripts", "generate", "source.js");
const validatorPath = path.join(repositoryRoot, "scripts", "validate.js");
const fixturePath = path.join(repositoryRoot, "tests", "fixtures", "source.json");

test("generator writes normalized chapter files only under the selected version", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bible-json-"));
  try {
    const result = spawnSync(
      process.execPath,
      [generatorPath, "kjv", fixturePath, temporaryRoot],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);

    const versionIndex = JSON.parse(
      fs.readFileSync(path.join(temporaryRoot, "data", "kjv", "index.json"), "utf8")
    );
    const chapter = JSON.parse(
      fs.readFileSync(path.join(temporaryRoot, "data", "kjv", "sample-book", "1.json"), "utf8")
    );
    assert.equal(versionIndex.books[0].chapters, 1);
    assert.deepEqual(chapter.verses.map(verse => verse.n), [1, 2]);
    assert.equal(chapter.verses[0].poetry, true);
    assert.deepEqual(chapter.headings, [{ beforeVerse: 1, text: "Sample heading" }]);
    assert.equal(fs.existsSync(path.join(temporaryRoot, "index.json")), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("generator rejects versions outside the public-domain scope", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bible-json-"));
  try {
    const result = spawnSync(
      process.execPath,
      [generatorPath, "other", fixturePath, temporaryRoot],
      { encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /version must be one of: kjv, web/);
    assert.equal(fs.existsSync(path.join(temporaryRoot, "data")), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("validator rejects a chapter fixture with non-consecutive verse numbers", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bible-json-invalid-"));
  try {
    fs.cpSync(path.join(repositoryRoot, "schema"), path.join(temporaryRoot, "schema"), {
      recursive: true
    });
    fs.writeFileSync(
      path.join(temporaryRoot, "index.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        datasetVersion: "1.0.0",
        versions: ["kjv", "web"].map(id => ({
          id,
          name: id,
          language: "en",
          license: "public-domain",
          path: `data/${id}/`
        }))
      })}\n`
    );

    for (const version of ["kjv", "web"]) {
      const bookDirectory = path.join(temporaryRoot, "data", version, "sample-book");
      fs.mkdirSync(bookDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(temporaryRoot, "data", version, "index.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          version,
          books: [{
            id: "sample-book",
            order: 1,
            testament: "old",
            name: "Sample Book",
            shortName: "Sample",
            chapters: 1
          }]
        })}\n`
      );
      fs.writeFileSync(
        path.join(bookDirectory, "1.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          version,
          book: "sample-book",
          chapter: 1,
          verses: [{ n: 2, text: "Sample verse." }]
        })}\n`
      );
    }

    const result = spawnSync(process.execPath, [validatorPath, temporaryRoot], {
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /data\/kjv\/sample-book\/1\.json \/verses\/0\/n: expected 1/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
