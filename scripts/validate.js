import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const expectedVersions = ["kjv", "web"];
const expectedTotals = { books: 66, chapters: 1189, verses: 31102 };
const expectedVersionMetadata = {
  kjv: "King James Version",
  web: "World English Bible"
};
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const markupPattern = /<\/?[a-z][^>]*>|```|`|\*\*|__|~~|\[[^\]]+\]\([^)]+\)|\[\d+\]|\*/i;

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/") || ".";
}

function readJson(root, filePath, errors) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const file = relativePath(root, filePath);
    if (raw.charCodeAt(0) === 0xfeff) errors.push(`${file}: UTF-8 BOM is not allowed`);
    if (raw.includes("\r")) errors.push(`${file}: use LF newlines`);
    if (raw.normalize("NFC") !== raw) errors.push(`${file}: file must use Unicode NFC`);
    const value = JSON.parse(raw);
    const lines = raw.split("\n");
    if (!raw.endsWith("\n")) errors.push(`${file}: JSON must end with LF`);
    if (
      lines.some(line => {
        const indentation = line.match(/^[ \t]*/)?.[0] ?? "";
        return indentation.includes("\t") || indentation.length % 2 !== 0;
      })
    ) {
      errors.push(`${file}: JSON indentation must use multiples of two spaces`);
    }
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${relativePath(root, filePath)}: ${detail}`);
    return undefined;
  }
}

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...listJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }
  return result;
}

function schemaValidator(root, schemaName, errors) {
  const schemaPath = path.join(root, "schema", schemaName);
  const schema = readJson(root, schemaPath, errors);
  if (schema === undefined) return null;
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

function checkSchema(root, filePath, validate, errors) {
  const value = readJson(root, filePath, errors);
  if (value === undefined || !validate) return null;
  if (!validate(value)) {
    for (const error of validate.errors ?? []) {
      errors.push(`${relativePath(root, filePath)} ${error.instancePath || "/"}: ${error.message}`);
    }
    return null;
  }
  return value;
}

function checkText(root, filePath, location, text, errors) {
  if (typeof text !== "string" || text.trim().length === 0) {
    errors.push(`${relativePath(root, filePath)} ${location}: text must be non-empty`);
  } else if (markupPattern.test(text)) {
    errors.push(`${relativePath(root, filePath)} ${location}: markup or footnote marker is not allowed`);
  } else if (text.normalize("NFC") !== text) {
    errors.push(`${relativePath(root, filePath)} ${location}: text must use Unicode NFC`);
  }
}

function validateVersion(root, version, bookSchema, chapterSchema, errors) {
  const versionIndexPath = path.join(root, "data", version, "index.json");
  const versionIndex = checkSchema(root, versionIndexPath, bookSchema, errors);
  if (!versionIndex) return { bookIds: [], chapters: 0, verses: 0 };
  if (versionIndex.version !== version) {
    errors.push(`${relativePath(root, versionIndexPath)}: version must be "${version}"`);
  }

  const books = versionIndex.books;
  const seenIds = new Set();
  let chapterTotal = 0;
  let verseTotal = 0;

  for (const [bookIndex, book] of books.entries()) {
    const bookLocation = `${relativePath(root, versionIndexPath)} /books/${bookIndex}`;
    if (!slugPattern.test(book.id)) {
      errors.push(`${bookLocation}/id: invalid book slug`);
    }
    if (seenIds.has(book.id)) {
      errors.push(`${bookLocation}/id: duplicate book slug "${book.id}"`);
    }
    seenIds.add(book.id);
    if (book.order !== bookIndex + 1) {
      errors.push(`${bookLocation}/order: expected ${bookIndex + 1}`);
    }

    const bookDirectory = path.join(root, "data", version, book.id);
    const allBookFiles = listJsonFiles(bookDirectory);
    const chapterFiles = allBookFiles.filter(filePath =>
      path.dirname(filePath) === bookDirectory && /^\d+\.json$/.test(path.basename(filePath))
    );
    if (chapterFiles.length !== book.chapters) {
      errors.push(
        `${relativePath(root, bookDirectory)}: index says ${book.chapters} chapters, found ${chapterFiles.length}`
      );
    }
    for (const filePath of chapterFiles) {
      const chapterNumber = Number(path.basename(filePath, ".json"));
      if (chapterNumber < 1 || chapterNumber > book.chapters) {
        errors.push(`${relativePath(root, filePath)}: chapter file is outside the indexed range`);
      }
    }
    for (const filePath of allBookFiles) {
      if (!chapterFiles.includes(filePath)) {
        errors.push(`${relativePath(root, filePath)}: unexpected file in book directory`);
      }
    }

    for (let chapterNumber = 1; chapterNumber <= book.chapters; chapterNumber += 1) {
      const chapterPath = path.join(bookDirectory, `${chapterNumber}.json`);
      const chapter = checkSchema(root, chapterPath, chapterSchema, errors);
      if (!chapter) continue;
      chapterTotal += 1;
      if (chapter.version !== version) {
        errors.push(`${relativePath(root, chapterPath)}: version must be "${version}"`);
      }
      if (chapter.book !== book.id) {
        errors.push(`${relativePath(root, chapterPath)}: book must be "${book.id}"`);
      }
      if (chapter.chapter !== chapterNumber) {
        errors.push(`${relativePath(root, chapterPath)}: chapter must be ${chapterNumber}`);
      }

      chapter.verses.forEach((verse, verseIndex) => {
        if (verse.n !== verseIndex + 1) {
          errors.push(
            `${relativePath(root, chapterPath)} /verses/${verseIndex}/n: expected ${verseIndex + 1}`
          );
        }
        checkText(root, chapterPath, `/verses/${verseIndex}/text`, verse.text, errors);
      });
      for (const [headingIndex, heading] of (chapter.headings ?? []).entries()) {
        if (heading.beforeVerse > chapter.verses.length) {
          errors.push(
            `${relativePath(root, chapterPath)} /headings/${headingIndex}/beforeVerse: outside chapter`
          );
        }
        checkText(root, chapterPath, `/headings/${headingIndex}/text`, heading.text, errors);
      }
      verseTotal += chapter.verses.length;
    }
  }

  const dataDirectory = path.join(root, "data", version);
  for (const filePath of listJsonFiles(dataDirectory)) {
    if (
      filePath !== versionIndexPath &&
      !seenIds.has(path.relative(dataDirectory, path.dirname(filePath)).split(path.sep)[0])
    ) {
      errors.push(`${relativePath(root, filePath)}: file is not listed in the version index`);
    }
  }

  const totals = { books: books.length, chapters: chapterTotal, verses: verseTotal };
  for (const [key, expected] of Object.entries(expectedTotals)) {
    if (totals[key] !== expected) {
      errors.push(
        `${relativePath(root, versionIndexPath)}: expected ${expected} ${key}, found ${totals[key]}`
      );
    }
  }
  return { bookIds: books.map(book => book.id), ...totals };
}

export function validateDataset(repositoryRoot = process.cwd()) {
  const root = path.resolve(repositoryRoot);
  const errors = [];
  const versionSchema = schemaValidator(root, "version.schema.json", errors);
  const bookSchema = schemaValidator(root, "book.schema.json", errors);
  const chapterSchema = schemaValidator(root, "chapter.schema.json", errors);
  const rootIndexPath = path.join(root, "index.json");
  const rootIndex = checkSchema(root, rootIndexPath, versionSchema, errors);

  if (!rootIndex) return errors;
  if (rootIndex.schemaVersion !== 1) {
    errors.push(`${relativePath(root, rootIndexPath)}: schemaVersion must be 1`);
  }
  if (rootIndex.datasetVersion === "0.0.0") {
    errors.push(`${relativePath(root, rootIndexPath)}: placeholder datasetVersion is not releasable`);
  }

  const versionIds = rootIndex.versions.map(version => version.id);
  if (new Set(versionIds).size !== versionIds.length) {
    errors.push(`${relativePath(root, rootIndexPath)}: version IDs must be unique`);
  }
  for (const expected of expectedVersions) {
    if (!versionIds.includes(expected)) {
      errors.push(`${relativePath(root, rootIndexPath)}: required version "${expected}" is missing`);
    }
  }
  for (const version of rootIndex.versions) {
    if (!expectedVersions.includes(version.id)) {
      errors.push(`${relativePath(root, rootIndexPath)}: unsupported version "${version.id}"`);
    }
    if (version.path !== `data/${version.id}/`) {
      errors.push(`${relativePath(root, rootIndexPath)}: path for "${version.id}" must be data/${version.id}/`);
    }
    if (expectedVersionMetadata[version.id] && version.name !== expectedVersionMetadata[version.id]) {
      errors.push(`${relativePath(root, rootIndexPath)}: name for "${version.id}" is incorrect`);
    }
    if (version.language !== "en") {
      errors.push(`${relativePath(root, rootIndexPath)}: language for "${version.id}" must be "en"`);
    }
  }

  const results = new Map();
  for (const version of expectedVersions) {
    results.set(version, validateVersion(root, version, bookSchema, chapterSchema, errors));
  }
  const kjvBookIds = results.get("kjv")?.bookIds ?? [];
  const webBookIds = results.get("web")?.bookIds ?? [];
  if (
    kjvBookIds.length > 0 &&
    webBookIds.length > 0 &&
    (kjvBookIds.length !== webBookIds.length ||
      kjvBookIds.some((bookId, index) => bookId !== webBookIds[index]))
  ) {
    errors.push("data/web/index.json: book slugs and order must match data/kjv/index.json");
  }

  return errors;
}

const repositoryRoot = process.argv[2] ?? process.cwd();
const errors = validateDataset(repositoryRoot);
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Dataset validation passed for ${expectedVersions.join(" and ")}.`);
}
