// Minimal XML parser — avoids DOMParser which is not available in Deno's worker context.
// Handles all XML patterns used in CalDAV: namespace prefixes, self-closing tags, attributes.

export interface XNode {
  ns: string; // resolved namespace URI
  local: string; // local name
  attrs: XAttr[];
  text: string; // concatenated direct text content
  children: XNode[];
}

export interface XAttr {
  ns: string;
  local: string;
  value: string;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { kind: "start"; fullName: string; attrStr: string; selfClose: boolean }
  | { kind: "end"; fullName: string }
  | { kind: "text"; text: string };

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = xml.length;

  while (i < n) {
    if (xml[i] !== "<") {
      const end = xml.indexOf("<", i);
      const text = end >= 0 ? xml.slice(i, end) : xml.slice(i);
      if (text) tokens.push({ kind: "text", text });
      i = end >= 0 ? end : n;
      continue;
    }

    i++; // skip '<'

    // Comment: <!-- ... -->
    if (xml.startsWith("!--", i)) {
      const end = xml.indexOf("-->", i);
      i = end >= 0 ? end + 3 : n;
      continue;
    }

    // CDATA: <![CDATA[ ... ]]>
    if (xml.startsWith("![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 8);
      const text = xml.slice(i + 8, end >= 0 ? end : n);
      if (text) tokens.push({ kind: "text", text });
      i = end >= 0 ? end + 3 : n;
      continue;
    }

    // Processing instruction: <? ... ?>
    if (xml[i] === "?") {
      const end = xml.indexOf("?>", i);
      i = end >= 0 ? end + 2 : n;
      continue;
    }

    // Doctype
    if (xml.startsWith("!DOCTYPE", i) || xml.startsWith("!doctype", i)) {
      const end = xml.indexOf(">", i);
      i = end >= 0 ? end + 1 : n;
      continue;
    }

    // End tag: </name>
    if (xml[i] === "/") {
      i++;
      const end = xml.indexOf(">", i);
      const fullName = xml.slice(i, end >= 0 ? end : n).trim();
      tokens.push({ kind: "end", fullName });
      i = end >= 0 ? end + 1 : n;
      continue;
    }

    // Start tag (possibly self-closing)
    const tagEnd = findTagClose(xml, i);
    const tagContent = xml.slice(i, tagEnd).trimEnd();
    const selfClose = tagContent.endsWith("/");
    const inner = selfClose ? tagContent.slice(0, -1).trimEnd() : tagContent;

    const spaceIdx = inner.search(/\s/);
    const fullName = spaceIdx >= 0 ? inner.slice(0, spaceIdx) : inner;
    const attrStr = spaceIdx >= 0 ? inner.slice(spaceIdx) : "";

    tokens.push({ kind: "start", fullName: fullName.trim(), attrStr, selfClose });
    i = tagEnd + 1;
  }

  return tokens;
}

function findTagClose(xml: string, i: number): number {
  let inQuote = false;
  let quoteChar = "";
  for (let j = i; j < xml.length; j++) {
    const c = xml[j];
    if (inQuote) {
      if (c === quoteChar) inQuote = false;
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
    } else if (c === ">") {
      return j;
    }
  }
  return xml.length;
}

// ─── Attribute parser ─────────────────────────────────────────────────────────

function parseAttrStr(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

// ─── Namespace resolution ─────────────────────────────────────────────────────

type NSScope = Map<string, string>;

function buildNSScope(rawAttrs: Record<string, string>, parent: NSScope): NSScope {
  const scope = new Map(parent);
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (k === "xmlns") scope.set("", v);
    else if (k.startsWith("xmlns:")) scope.set(k.slice(6), v);
  }
  return scope;
}

function resolveNS(prefixedName: string, scope: NSScope): { ns: string; local: string } {
  const colon = prefixedName.indexOf(":");
  if (colon < 0) return { ns: scope.get("") ?? "", local: prefixedName };
  return { ns: scope.get(prefixedName.slice(0, colon)) ?? "", local: prefixedName.slice(colon + 1) };
}

function resolveAttrs(rawAttrs: Record<string, string>, scope: NSScope): XAttr[] {
  const result: XAttr[] = [];
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (k === "xmlns" || k.startsWith("xmlns:")) continue;
    const { ns, local } = resolveNS(k, scope);
    result.push({ ns, local, value: v });
  }
  return result;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Tree builder (iterative, avoids recursion depth limits) ──────────────────

function buildFromTokens(tokens: Token[]): XNode | null {
  const stack: { node: XNode; scope: NSScope }[] = [];
  let root: XNode | null = null;
  const rootScope: NSScope = new Map([["", ""]]);

  for (const tok of tokens) {
    if (tok.kind === "text") {
      if (stack.length > 0) {
        stack[stack.length - 1].node.text += xmlUnescape(tok.text);
      }
      continue;
    }

    if (tok.kind === "end") {
      stack.pop();
      continue;
    }

    // Start token
    const parentScope = stack.length > 0 ? stack[stack.length - 1].scope : rootScope;
    const rawAttrs = parseAttrStr(tok.attrStr);
    const scope = buildNSScope(rawAttrs, parentScope);
    const { ns, local } = resolveNS(tok.fullName, scope);
    const attrs = resolveAttrs(rawAttrs, scope);

    const node: XNode = { ns, local, attrs, text: "", children: [] };

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      root = node;
    }

    if (!tok.selfClose) {
      stack.push({ node, scope });
    }
  }

  return root;
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse an XML string into a node tree. Returns the root element, or null if empty/invalid.
 * Namespace prefixes are resolved to namespace URIs.
 */
export function parseXML(xml: string): XNode | null {
  return buildFromTokens(tokenize(xml));
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/** First direct child with matching ns+local. */
export function find(node: XNode, ns: string, local: string): XNode | undefined {
  return node.children.find((c) => c.ns === ns && c.local === local);
}

/** All direct children with matching ns+local. */
export function findAll(node: XNode, ns: string, local: string): XNode[] {
  return node.children.filter((c) => c.ns === ns && c.local === local);
}

/** First descendant at any depth with matching ns+local. */
export function findDeep(node: XNode, ns: string, local: string): XNode | undefined {
  for (const child of node.children) {
    if (child.ns === ns && child.local === local) return child;
    const found = findDeep(child, ns, local);
    if (found) return found;
  }
  return undefined;
}

/** All descendants at any depth with matching ns+local. */
export function findAllDeep(node: XNode, ns: string, local: string): XNode[] {
  const results: XNode[] = [];
  function walk(n: XNode) {
    for (const c of n.children) {
      if (c.ns === ns && c.local === local) results.push(c);
      walk(c);
    }
  }
  walk(node);
  return results;
}

/** Get attribute value by local name (first match, any namespace). */
export function attr(node: XNode, local: string): string | undefined {
  return node.attrs.find((a) => a.local === local)?.value;
}
