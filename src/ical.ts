// iCalendar parsing, validation, and in-process filtering.
// Uses a native parser to avoid npm dependency issues.

import type { CompFilter, PropFilter, TextMatch } from "./xml.ts";

// ─── Minimal iCalendar parser ─────────────────────────────────────────────────

export interface ICalProp {
  name: string;
  params: Record<string, string>;
  value: string;
  rawLine: string;
}

export interface ICalComponent {
  name: string;
  props: ICalProp[];
  children: ICalComponent[];
}

/** Unfold and split an iCalendar text into logical lines. */
function unfold(ics: string): string[] {
  // Normalize line endings to \n
  const text = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Unfold continuation lines (RFC 5545 §3.1)
  const unfolded = text.replace(/\n[ \t]/g, "");
  return unfolded.split("\n").filter((l) => l.length > 0);
}

/** Parse a single iCal property line into name, params, value. */
function parsePropLine(line: string): ICalProp {
  // property = name *(";" param) ":" value
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return { name: line.toUpperCase(), params: {}, value: "", rawLine: line };

  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq >= 0) {
      params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
    } else {
      params[parts[i].toUpperCase()] = "";
    }
  }
  return { name, params, value, rawLine: line };
}

/** Parse iCalendar text into a component tree. */
export function parseICS(ics: string): ICalComponent {
  const lines = unfold(ics);
  const stack: ICalComponent[] = [{ name: "ROOT", props: [], children: [] }];

  for (const line of lines) {
    const uline = line.toUpperCase();
    if (uline.startsWith("BEGIN:")) {
      const compName = line.slice(6).toUpperCase();
      const comp: ICalComponent = { name: compName, props: [], children: [] };
      stack[stack.length - 1].children.push(comp);
      stack.push(comp);
    } else if (uline.startsWith("END:")) {
      if (stack.length > 1) stack.pop();
    } else {
      if (stack.length > 0) {
        stack[stack.length - 1].props.push(parsePropLine(line));
      }
    }
  }

  // Return the VCALENDAR component (first child of ROOT)
  return stack[0].children[0] ?? { name: "VCALENDAR", props: [], children: [] };
}

/** Get first property value (case-insensitive). */
export function getProp(comp: ICalComponent, name: string): ICalProp | undefined {
  return comp.props.find((p) => p.name === name.toUpperCase());
}

/** Get all properties with the given name. */
export function getProps(comp: ICalComponent, name: string): ICalProp[] {
  return comp.props.filter((p) => p.name === name.toUpperCase());
}

/** Get first sub-component by name. */
export function getComp(comp: ICalComponent, name: string): ICalComponent | undefined {
  return comp.children.find((c) => c.name === name.toUpperCase());
}

/** Get all sub-components by name. */
export function getComps(comp: ICalComponent, name: string): ICalComponent[] {
  return comp.children.filter((c) => c.name === name.toUpperCase());
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  code: number; // HTTP status
  precondition?: string; // CalDAV precondition name
  message: string;
}

/** Validate a VCALENDAR per RFC 4791 §4.1. */
export function validateCalendarObject(cal: ICalComponent): ValidationError | null {
  // Must be VCALENDAR
  if (cal.name !== "VCALENDAR") {
    return { code: 400, precondition: "valid-calendar-data", message: "Not a VCALENDAR" };
  }

  // Must have VERSION:2.0 (RFC 5545 §3.6)
  const version = getProp(cal, "VERSION");
  if (!version || version.value !== "2.0") {
    return { code: 400, precondition: "valid-calendar-data", message: "VERSION:2.0 is required" };
  }

  // Must have PRODID (RFC 5545 §3.6)
  const prodid = getProp(cal, "PRODID");
  if (!prodid || !prodid.value) {
    return { code: 400, precondition: "valid-calendar-data", message: "PRODID is required" };
  }

  // No METHOD property allowed in stored objects (RFC 5546)
  const method = getProp(cal, "METHOD");
  if (method) {
    return {
      code: 403,
      precondition: "valid-calendar-object-resource",
      message: "METHOD property not allowed in stored calendar objects",
    };
  }

  // Count component types (only VEVENT and VTODO supported)
  const vevents = getComps(cal, "VEVENT");
  const vtodos = getComps(cal, "VTODO");
  const total = vevents.length + vtodos.length;

  if (total === 0) {
    // Check for unsupported types like VJOURNAL
    const others = cal.children.filter(
      (c) => !["VTIMEZONE", "VEVENT", "VTODO"].includes(c.name),
    );
    if (others.length > 0) {
      return {
        code: 403,
        precondition: "supported-calendar-component",
        message: `Unsupported component type: ${others[0].name}`,
      };
    }
    return { code: 400, precondition: "valid-calendar-data", message: "No VEVENT or VTODO found" };
  }

  if (vevents.length > 0 && vtodos.length > 0) {
    return {
      code: 403,
      precondition: "valid-calendar-object-resource",
      message: "Mixed component types not allowed",
    };
  }

  // All calendar components must share a single UID
  const components = [...vevents, ...vtodos];
  const uids = new Set(components.map((c) => getProp(c, "UID")?.value ?? ""));
  if (uids.has("")) {
    return {
      code: 400,
      precondition: "valid-calendar-data",
      message: "UID property is required",
    };
  }
  if (uids.size > 1) {
    return {
      code: 403,
      precondition: "valid-calendar-object-resource",
      message: "Multiple UIDs not allowed in a single calendar object",
    };
  }

  // DTSTAMP is required on every VEVENT and VTODO (RFC 5545 §3.6.1, §3.6.2)
  for (const comp of components) {
    if (!getProp(comp, "DTSTAMP")) {
      return {
        code: 400,
        precondition: "valid-calendar-data",
        message: `DTSTAMP is required in ${comp.name}`,
      };
    }
  }

  return null;
}

/** Extract the primary UID from a valid VCALENDAR. */
export function extractUID(cal: ICalComponent): string {
  for (const comp of cal.children) {
    const uid = getProp(comp, "UID");
    if (uid) return uid.value;
  }
  return "";
}

/** Returns the component type ("VEVENT", "VTODO", or ""). */
export function primaryComponentType(cal: ICalComponent): string {
  if (getComps(cal, "VEVENT").length > 0) return "VEVENT";
  if (getComps(cal, "VTODO").length > 0) return "VTODO";
  return "";
}

// ─── DateTime parsing ─────────────────────────────────────────────────────────

/** Parse an iCalendar DATE or DATE-TIME value to a JS Date (UTC). */
function parseDateTime(value: string, params: Record<string, string>): Date | null {
  if (!value) return null;

  // DATE-only: YYYYMMDD
  if (value.length === 8 || params["VALUE"] === "DATE") {
    return new Date(
      Date.UTC(
        parseInt(value.slice(0, 4)),
        parseInt(value.slice(4, 6)) - 1,
        parseInt(value.slice(6, 8)),
      ),
    );
  }

  // DATE-TIME in UTC: YYYYMMDDTHHmmssZ
  if (value.endsWith("Z")) {
    return new Date(
      Date.UTC(
        parseInt(value.slice(0, 4)),
        parseInt(value.slice(4, 6)) - 1,
        parseInt(value.slice(6, 8)),
        parseInt(value.slice(9, 11)),
        parseInt(value.slice(11, 13)),
        parseInt(value.slice(13, 15)),
      ),
    );
  }

  // DATE-TIME floating (treat as UTC for simplicity)
  return new Date(
    Date.UTC(
      parseInt(value.slice(0, 4)),
      parseInt(value.slice(4, 6)) - 1,
      parseInt(value.slice(6, 8)),
      parseInt(value.slice(9, 11)),
      parseInt(value.slice(11, 13)),
      parseInt(value.slice(13, 15)),
    ),
  );
}

function getPropDate(comp: ICalComponent, name: string): Date | null {
  const p = getProp(comp, name);
  if (!p) return null;
  return parseDateTime(p.value, p.params);
}

// ─── In-process filtering ─────────────────────────────────────────────────────

/** Returns true if the ics string matches the CalDAV comp-filter tree. */
export function matchesFilter(ics: string, filter: CompFilter): boolean {
  try {
    const cal = parseICS(ics);
    return matchComp(filter, cal);
  } catch {
    return false;
  }
}

function matchComp(filter: CompFilter, comp: ICalComponent): boolean {
  // The comp must match by name (case-insensitive)
  if (comp.name !== filter.name.toUpperCase()) {
    return filter.isNotDefined;
  }

  // time-range on the comp itself
  if (filter.start || filter.end) {
    if (!matchCompTimeRange(filter.start, filter.end, comp)) return false;
  }

  // All nested comp-filters must match at least one child
  for (const cf of filter.comps) {
    if (!matchCompFilter(cf, comp)) return false;
  }

  // All prop-filters must match
  for (const pf of filter.props) {
    if (!matchPropFilter(pf, comp)) return false;
  }

  return true;
}

function matchCompFilter(filter: CompFilter, parent: ICalComponent): boolean {
  const children = parent.children.filter((c) => c.name === filter.name.toUpperCase());
  if (children.length === 0) return filter.isNotDefined;

  for (const child of children) {
    if (matchComp(filter, child)) return true;
  }
  return false;
}

function matchCompTimeRange(
  start: Date | undefined,
  end: Date | undefined,
  comp: ICalComponent,
): boolean {
  const dtStart = getPropDate(comp, "DTSTART");
  let dtEnd = getPropDate(comp, "DTEND") ?? getPropDate(comp, "DUE");

  if (!dtStart) return false;

  // If no DTEND/DUE, use DTSTART as end (for all-day or instant events)
  if (!dtEnd) {
    dtEnd = new Date(dtStart.getTime() + 24 * 60 * 60 * 1000); // Add 1 day for DATE-only
  }

  const rangeStart = start ?? new Date(0);
  const rangeEnd = end ?? new Date(8.64e15);

  // Overlap: event start < range end AND event end > range start
  return dtStart < rangeEnd && dtEnd > rangeStart;
}

function matchPropFilter(filter: PropFilter, comp: ICalComponent): boolean {
  const props = getProps(comp, filter.name);
  if (props.length === 0) return filter.isNotDefined;
  if (filter.isNotDefined) return false;

  for (const prop of props) {
    if (matchesPropFilter(filter, prop)) return true;
  }
  return false;
}

function matchesPropFilter(filter: PropFilter, prop: ICalProp): boolean {
  if (filter.start || filter.end) {
    const dt = parseDateTime(prop.value, prop.params);
    if (!dt) return false;
    const rangeStart = filter.start ?? new Date(0);
    const rangeEnd = filter.end ?? new Date(8.64e15);
    return dt >= rangeStart && dt < rangeEnd;
  }
  if (filter.textMatch) {
    return matchesTextMatch(filter.textMatch, prop.value);
  }
  // Check param filters
  for (const pf of filter.paramFilters) {
    if (!matchParamFilter(pf, prop)) return false;
  }
  return true;
}

function matchParamFilter(filter: { name: string; isNotDefined: boolean; textMatch?: TextMatch }, prop: ICalProp): boolean {
  const value = prop.params[filter.name.toUpperCase()];
  if (value === undefined) return filter.isNotDefined;
  if (filter.isNotDefined) return false;
  if (filter.textMatch) return matchesTextMatch(filter.textMatch, value);
  return true;
}

function matchesTextMatch(tm: TextMatch, value: string): boolean {
  const match = value.toLowerCase().includes(tm.text.toLowerCase());
  return tm.negateCondition ? !match : match;
}
