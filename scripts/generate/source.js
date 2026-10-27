import fs from "node:fs";
import path from "node:path";
import { slugPattern, textProblem } from "../validate.js";

const allowedVersions = new Set(["kjv", "web"]);
const verseFlags = ["poetry", "paragraphStart", "wordsOfJesus"];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requireText(value, location, options) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${location}: expected non-empty text`);
  }
  // Only whitespace and Unicode form are normalized; the words are never changed.
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  const problem = textProblem(normalized, options);
  if (problem) throw new Error(`${location}: ${problem}`);
  return normalized;
}

function normalizeSource(source, version) {
  if (!source || typeof source !== "object" || !Array.isArray(source.books)) {
    throw new Error("source: expected an object with a books array");
  }
  if (source.version !== version) {
    throw new Error(`source.version: expected "${version}"`);
  }

  const seenBooks = new Set();
  return source.books.map((book, bookIndex) => {
    const location = `source.books[${bookIndex}]`;
    if (!book || typeof book !== "object" || !slugPattern.test(book.id ?? "")) {
      throw new Error(`${location}.id: expected a lowercase book slug`);
    }
    if (seenBooks.has(book.id)) {
      throw new Error(`${location}.id: duplicate book slug "${book.id}"`);
    }
    seenBooks.add(book.id);

    if (!["old", "new", "deuterocanonical"].includes(book.testament)) {
      throw new Error(`${location}.testament: invalid testament`);
    }
    if (!Array.isArray(book.chapters) || book.chapters.length === 0) {
      throw new Error(`${location}.chapters: expected a non-empty array`);
    }

    const chapters = book.chapters.map((chapter, chapterIndex) => {
      const chapterLocation = `${location}.chapters[${chapterIndex}]`;
      if (chapter?.chapter !== chapterIndex + 1) {
        throw new Error(`${chapterLocation}.chapter: expected ${chapterIndex + 1}`);
      }
      if (!Array.isArray(chapter.verses) || chapter.verses.length === 0) {
        throw new Error(`${chapterLocation}.verses: expected a non-empty array`);
      }

      const verses = chapter.verses.map((verse, verseIndex) => {
        const verseLocation = `${chapterLocation}.verses[${verseIndex}]`;
        if (verse?.n !== verseIndex + 1) {
          throw new Error(`${verseLocation}.n: expected ${verseIndex + 1}`);
        }
        const normalizedVerse = {
          n: verse.n,
          text: requireText(verse.text, `${verseLocation}.text`, { verse: true })
        };
        for (const flag of verseFlags) {
          if (verse[flag] === true) normalizedVerse[flag] = true;
          else if (verse[flag] !== undefined && verse[flag] !== false) {
            throw new Error(`${verseLocation}.${flag}: expected a boolean`);
          }
        }
        return normalizedVerse;
      });

      const normalizedChapter = { chapter: chapter.chapter, verses };
      if (chapter.headings !== undefined) {
        if (!Array.isArray(chapter.headings)) {
          throw new Error(`${chapterLocation}.headings: expected an array`);
        }
        const headings = chapter.headings.map((heading, headingIndex) => {
          const headingLocation = `${chapterLocation}.headings[${headingIndex}]`;
          if (
            !Number.isInteger(heading?.beforeVerse) ||
            heading.beforeVerse < 1 ||
            heading.beforeVerse > verses.length
          ) {
            throw new Error(`${headingLocation}.beforeVerse: outside chapter`);
          }
          return {
            beforeVerse: heading.beforeVerse,
            text: requireText(heading.text, `${headingLocation}.text`)
          };
        });
        if (headings.length > 0) normalizedChapter.headings = headings;
      }
      return normalizedChapter;
    });

    return {
      id: book.id,
      order: bookIndex + 1,
      testament: book.testament,
      name: requireText(book.name, `${location}.name`),
      shortName: requireText(book.shortName, `${location}.shortName`),
      chapters
    };
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function generate(version, sourcePath, repositoryRoot) {
  if (!allowedVersions.has(version)) {
    throw new Error(`version must be one of: ${[...allowedVersions].join(", ")}`);
  }

  const absoluteSourcePath = path.resolve(sourcePath);
  const source = JSON.parse(fs.readFileSync(absoluteSourcePath, "utf8"));
  const books = normalizeSource(source, version);
  const outputDirectory = path.resolve(repositoryRoot, "data", version);
  // Start from an empty version directory so renamed books or removed chapters leave no stale files.
  fs.rmSync(outputDirectory, { recursive: true, force: true });

  writeJson(path.join(outputDirectory, "index.json"), {
    schemaVersion: 1,
    version,
    books: books.map(({ id, order, testament, name, shortName, chapters }) => ({
      id,
      order,
      testament,
      name,
      shortName,
      chapters: chapters.length
    }))
  });

  for (const book of books) {
    for (const chapter of book.chapters) {
      const chapterData = {
        schemaVersion: 1,
        version,
        book: book.id,
        chapter: chapter.chapter,
        verses: chapter.verses
      };
      if (chapter.headings) chapterData.headings = chapter.headings;
      writeJson(path.join(outputDirectory, book.id, `${chapter.chapter}.json`), chapterData);
    }
  }

  console.log(`Generated ${books.length} books for ${version} in ${outputDirectory}`);
}

const [version, sourcePath, repositoryRoot = process.cwd()] = process.argv.slice(2);
if (!version || !sourcePath) {
  fail("Usage: node scripts/generate/source.js <kjv|web> <source.json> [repository-root]");
} else {
  try {
    generate(version, sourcePath, repositoryRoot);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
