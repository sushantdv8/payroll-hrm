// Turns the SQL the app writes for SQLite / Cloudflare D1 into PostgreSQL.
// The app keeps its JSON documents in TEXT columns; they are read with the `json` type (not jsonb) so a nested object
// comes back with exactly the text that was stored.
//
// Handled: ? placeholders -> $1.., json_extract / json_each / json_set, instr, COLLATE NOCASE, LIKE (SQLite's LIKE ignores
// case), CROSS JOIN ... ON, REAL. Everything else the app uses (ON CONFLICT, COALESCE, CAST, substr, UNION, IN, ...) is the
// same in both.

// Splits SQL into quoted literals and the code between them, so rewrites never touch text inside 'quotes'.
function split(sql) {
  const parts = [];
  let i = 0, start = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (i > start) parts.push({ code: true, text: sql.slice(start, i) });
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j++; continue; } break; }
      }
      parts.push({ code: false, text: sql.slice(i, j + 1) });
      i = start = j + 1;
    } else i++;
  }
  if (start < sql.length) parts.push({ code: true, text: sql.slice(start) });
  return parts;
}

// Index of the ")" that closes the "(" at `open`, ignoring quotes and nested brackets.
function closing(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('Unbalanced parentheses in SQL');
}

// Top-level, comma-separated arguments of the text between a function's parentheses.
function args(text) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") { i++; while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(from, i).trim()); from = i + 1; }
  }
  out.push(text.slice(from).trim());
  return out;
}

// '$.a.b[0].c' -> {a,b,0,c}
function pathArray(literal) {
  const m = /^'\$((?:\.[A-Za-z0-9_]+|\[\d+\])*)'$/.exec(literal);
  if (!m) throw new Error('Unsupported JSON path ' + literal);
  const keys = [...m[1].matchAll(/\.([A-Za-z0-9_]+)|\[(\d+)\]/g)].map((k) => k[1] ?? k[2]);
  return "'{" + keys.join(',') + "}'";
}

const FUNCTIONS = {
  json_extract(a) {
    const [doc, path] = a;
    const dynamic = /^'\$\.'\s*\|\|\s*([\s\S]+)$/.exec(path);
    if (dynamic) return `((${doc})::json ->> (${dynamic[1].trim()}))`;
    return `((${doc})::json #>> ${pathArray(path)})`;
  },
  // json_set(doc, path, value, path, value ...) -> nested jsonb_set. Rewrites the document in jsonb's own layout.
  json_set(a) {
    let out = `(${a[0]})::jsonb`;
    for (let i = 1; i + 1 < a.length; i += 2) out = `jsonb_set(${out}, ${pathArray(a[i])}, to_jsonb(${a[i + 1]}))`;
    return `(${out})::text`;
  },
  instr(a) { return `strpos(${a[0]}, ${a[1]})`; },
};

// Rewrites FUNCTION(...) calls, innermost arguments first. json_each is a table function and needs the alias that follows it.
function rewriteFunctions(sql) {
  const names = [...Object.keys(FUNCTIONS), 'json_each'].join('|');
  const re = new RegExp(`\\b(${names})\\s*\\(`, 'i');
  for (;;) {
    // Work on code outside literals only.
    let hit = null, offset = 0;
    for (const part of split(sql)) {
      if (part.code) {
        const m = re.exec(part.text);
        if (m) { hit = { name: m[1].toLowerCase(), at: offset + m.index, open: offset + m.index + m[0].length - 1 }; break; }
      }
      offset += part.text.length;
    }
    if (!hit) return sql;
    const end = closing(sql, hit.open);
    const inner = rewriteFunctions(sql.slice(hit.open + 1, end));
    if (hit.name === 'json_each') {
      const rest = sql.slice(end + 1);
      const alias = /^\s+(?!(?:WHERE|CROSS|INNER|LEFT|JOIN|ON|ORDER|GROUP|LIMIT|UNION|ON|AS|SET|HAVING)\b)([A-Za-z_][A-Za-z0-9_]*)/i.exec(rest);
      const name = alias ? alias[1] : 'je';
      sql = sql.slice(0, hit.at) + `json_array_elements(CAST(${inner} AS json)) AS ${name}(value)` + (alias ? rest.slice(alias[0].length) : rest);
    } else {
      sql = sql.slice(0, hit.at) + FUNCTIONS[hit.name](args(inner)) + sql.slice(end + 1);
    }
  }
}

export function toPg(sql) {
  // ? -> $1, $2 ... in order of appearance
  let n = 0;
  sql = split(sql).map((p) => (p.code ? p.text.replace(/\?/g, () => '$' + ++n) : p.text)).join('');
  sql = rewriteFunctions(sql);
  return split(sql).map((p) => (p.code
    ? p.text
      .replace(/\b([A-Za-z_][A-Za-z0-9_.]*)\s+COLLATE\s+NOCASE\b/gi, 'lower($1)')
      .replace(/\bCROSS\s+JOIN\b/gi, 'JOIN')
      .replace(/\bLIKE\b/gi, 'ILIKE')
      .replace(/\bAS\s+REAL\b/gi, 'AS DOUBLE PRECISION')
    : p.text)).join('');
}
