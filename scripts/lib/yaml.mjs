// Minimal YAML reader. No dependencies: the website workflow runs `node` on a
// bare checkout with no `npm install`, so we cannot pull in js-yaml.
//
// Supports the subset we actually consume:
//   - nested block maps (by indentation)
//   - block sequences ("- item", including "- key: value" maps)
//   - flow sequences [a, b] and flow maps {a: b}
//   - quoted and bare scalars, numbers, booleans, null
//   - "#" comments and "---" document markers
// It is deliberately NOT a general YAML implementation. It parses the suite
// configs in this repo and the summary.yaml MFC writes; nothing else.

function stripComment(line) {
  let out = "", qc = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (qc) {
      out += ch;
      if (ch === qc && line[i - 1] !== "\\") qc = null;
      continue;
    }
    if (ch === '"' || ch === "'") { qc = ch; out += ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out;
}

export function parseScalar(raw) {
  const s = String(raw).trim();
  if (s === "" ) return null;
  if (/^(null|~)$/i.test(s)) return null;
  if (/^(true|yes|on)$/i.test(s)) return true;
  if (/^(false|no|off)$/i.test(s)) return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map(parseScalar);
  if (s.startsWith("{") && s.endsWith("}")) {
    const o = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      o[parseScalar(part.slice(0, i))] = parseScalar(part.slice(i + 1));
    }
    return o;
  }
  return s;
}

// Split on commas that are not inside quotes or nested brackets.
function splitFlow(s) {
  const out = []; let cur = "", depth = 0, qc = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (qc) { cur += ch; if (ch === qc && s[i - 1] !== "\\") qc = null; continue; }
    if (ch === '"' || ch === "'") { qc = ch; cur += ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*---\s*$/.test(raw) || /^\s*\.\.\.\s*$/.test(raw)) continue;
    const noComment = stripComment(raw);
    if (noComment.trim() === "") continue;
    lines.push({ indent: noComment.match(/^ */)[0].length, text: noComment.trim() });
  }
  let pos = 0;

  function parseBlock(minIndent) {
    // A block is a sequence if its first line starts with "- ", else a map.
    if (pos >= lines.length) return null;
    if (lines[pos].text.startsWith("- ") || lines[pos].text === "-") {
      const arr = [];
      const indent = lines[pos].indent;
      while (pos < lines.length && lines[pos].indent === indent &&
             (lines[pos].text.startsWith("- ") || lines[pos].text === "-")) {
        const item = lines[pos].text === "-" ? "" : lines[pos].text.slice(2).trim();
        pos++;
        if (item === "") { arr.push(parseBlock(indent + 1)); continue; }
        // "- key: value" starts an inline map that may continue on later lines.
        const ci = colonIndex(item);
        if (ci >= 0 && !item.startsWith("[") && !item.startsWith("{")) {
          const obj = {};
          const k = item.slice(0, ci).trim();
          const v = item.slice(ci + 1).trim();
          obj[k] = v === "" ? parseBlock(indent + 1) : parseScalar(v);
          while (pos < lines.length && lines[pos].indent > indent &&
                 !lines[pos].text.startsWith("- ")) {
            const l = lines[pos].text; const c2 = colonIndex(l);
            if (c2 < 0) { pos++; continue; }
            const k2 = l.slice(0, c2).trim(); const v2 = l.slice(c2 + 1).trim();
            const ind2 = lines[pos].indent; pos++;
            obj[k2] = v2 === "" ? parseBlock(ind2 + 1) : parseScalar(v2);
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(item));
        }
      }
      return arr;
    }
    const obj = {};
    const indent = lines[pos].indent;
    while (pos < lines.length && lines[pos].indent >= minIndent) {
      if (lines[pos].indent !== indent) break;
      const l = lines[pos].text;
      const ci = colonIndex(l);
      if (ci < 0) { pos++; continue; }
      const key = parseScalar(l.slice(0, ci));
      const val = l.slice(ci + 1).trim();
      pos++;
      if (val === "") {
        const nested = (pos < lines.length && lines[pos].indent > indent) ||
                       (pos < lines.length && lines[pos].text.startsWith("- ") &&
                        lines[pos].indent >= indent);
        obj[key] = nested ? parseBlock(indent + 1) : null;
      } else {
        obj[key] = parseScalar(val);
      }
    }
    return obj;
  }

  function colonIndex(s) {
    let qc = null, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (qc) { if (ch === qc && s[i - 1] !== "\\") qc = null; continue; }
      if (ch === '"' || ch === "'") { qc = ch; continue; }
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === ":" && depth === 0 && (i + 1 >= s.length || /[\s]/.test(s[i + 1]))) return i;
    }
    return -1;
  }

  const result = parseBlock(0);
  return result === null ? {} : result;
}
