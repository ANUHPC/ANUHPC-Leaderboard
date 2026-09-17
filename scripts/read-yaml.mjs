// Print one value out of a YAML file, for shell scripts.
//
//   node scripts/read-yaml.mjs <file> <dotted.path> [default]
//
// Exists as a real file rather than an inline `node -e` on purpose. Inline
// scripts here have gone wrong twice: once mixing require() with a top-level
// await import() (which flips node into ESM and breaks require), and once
// using a static `import ... from process.argv[1]`, which is a syntax error
// because static import specifiers must be literals. A file has none of those
// traps and can be tested directly.
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "./lib/yaml.mjs";

const [file, dotted, fallback = ""] = process.argv.slice(2);

if (!file || !dotted) {
  process.stderr.write("usage: read-yaml.mjs <file> <dotted.path> [default]\n");
  process.exit(2);
}

let doc;
try {
  doc = parseYaml(fs.readFileSync(path.resolve(file), "utf8"));
} catch (e) {
  process.stderr.write(`read-yaml: cannot read ${file}: ${e.message}\n`);
  process.exit(1);
}

const value = dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), doc);

// An absent key and an explicitly empty one both fall back, so callers can
// write `PART=$(read-yaml job.yml resources.partition cpu)` and get "cpu".
process.stdout.write(String(value == null || value === "" ? fallback : value));
