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

/** Returns true if the value is a UTC DATE-TIME (contains T and ends with Z). */
function isUTCDateTime(value: string): boolean {
  return value.includes("T") && value.endsWith("Z");
}

/** Returns the value type of a DATE or DATE-TIME property. */
function getValueType(prop: ICalProp): "DATE" | "DATE-TIME" {
  if (prop.params["VALUE"] === "DATE" || prop.value.length === 8) return "DATE";
  return "DATE-TIME";
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

  // Duplicate PRODID not allowed
  if (getProps(cal, "PRODID").length > 1) {
    return { code: 400, precondition: "valid-calendar-data", message: "Duplicate PRODID" };
  }

  // Duplicate VERSION not allowed
  if (getProps(cal, "VERSION").length > 1) {
    return { code: 400, precondition: "valid-calendar-data", message: "Duplicate VERSION" };
  }

  // METHOD: only CANCEL is allowed (RFC 5546 §3.2.5)
  const method = getProp(cal, "METHOD");
  if (method && method.value.toUpperCase() !== "CANCEL") {
    return {
      code: 403,
      precondition: "valid-calendar-object-resource",
      message: `METHOD:${method.value} is not allowed in stored calendar objects`,
    };
  }
  const isCancel = method?.value.toUpperCase() === "CANCEL";

  // VTIMEZONE must be present for any TZID reference (RFC 5545 §3.1.2).
  // RFC 7809 §3.1.4: non-standard X-* TZIDs without VTIMEZONE return 403/valid-timezone;
  // all other unknown TZIDs return 400/valid-calendar-data.
  const vtimezoneIds = new Set(getComps(cal, "VTIMEZONE").map((vtz) => getProp(vtz, "TZID")?.value ?? "").filter(Boolean));
  const dateTimeProps = ["DTSTART", "DTEND", "DUE", "COMPLETED", "CREATED", "LAST-MODIFIED", "RECURRENCE-ID", "TRIGGER"];
  for (const comp of cal.children) {
    for (const propName of dateTimeProps) {
      for (const prop of getProps(comp, propName)) {
        const tzid = prop.params["TZID"];
        if (tzid && !vtimezoneIds.has(tzid)) {
          if (tzid.startsWith("X-")) {
            return {
              code: 403,
              precondition: "valid-timezone",
              message: `Unknown timezone TZID=${tzid}: no embedded VTIMEZONE present`,
            };
          }
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: `VTIMEZONE component required for TZID=${tzid} used in ${propName}`,
          };
        }
      }
    }
  }

  // VTIMEZONE: each STANDARD/DAYLIGHT sub-component must have TZOFFSETFROM
  for (const vtz of getComps(cal, "VTIMEZONE")) {
    for (const sub of vtz.children) {
      if (sub.name === "STANDARD" || sub.name === "DAYLIGHT") {
        if (!getProp(sub, "TZOFFSETFROM")) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VTIMEZONE STANDARD/DAYLIGHT missing TZOFFSETFROM",
          };
        }
      }
    }
  }

  // Count component types (VEVENT, VTODO, VAVAILABILITY, and VFREEBUSY supported)
  const vevents = getComps(cal, "VEVENT");
  const vtodos = getComps(cal, "VTODO");
  const vavails = getComps(cal, "VAVAILABILITY");
  const vfreebusy = getComps(cal, "VFREEBUSY");
  const total = vevents.length + vtodos.length + vavails.length + vfreebusy.length;

  if (total === 0) {
    // Check for unsupported types like VJOURNAL
    const SUPPORTED = ["VTIMEZONE", "VEVENT", "VTODO", "VAVAILABILITY", "VFREEBUSY"];
    const others = cal.children.filter((c) => !SUPPORTED.includes(c.name));
    if (others.length > 0) {
      return {
        code: 403,
        precondition: "supported-calendar-component",
        message: `Unsupported component type: ${others[0].name}`,
      };
    }
    return { code: 400, precondition: "valid-calendar-data", message: "No VEVENT, VTODO, VAVAILABILITY, or VFREEBUSY found" };
  }

  // VFREEBUSY: minimal validation — require UID and DTSTAMP
  for (const comp of vfreebusy) {
    if (!getProp(comp, "UID")) {
      return { code: 400, precondition: "valid-calendar-data", message: "VFREEBUSY UID is required" };
    }
    if (!getProp(comp, "DTSTAMP")) {
      return { code: 400, precondition: "valid-calendar-data", message: "VFREEBUSY DTSTAMP is required" };
    }
    // Skip further VEVENT/VTODO validation below
  }
  if (vfreebusy.length > 0 && vevents.length === 0 && vtodos.length === 0 && vavails.length === 0) {
    return null; // pure VFREEBUSY object — no further validation needed
  }

  // VAVAILABILITY validation (RFC 7953 §3.1)
  if (vavails.length > 0) {
    for (const comp of vavails) {
      // UID required
      if (!getProp(comp, "UID")) {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY UID is required" };
      }
      // DTSTAMP required
      if (!getProp(comp, "DTSTAMP")) {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY DTSTAMP is required" };
      }
      const dtstart = getProp(comp, "DTSTART");
      const dtend = getProp(comp, "DTEND");
      const duration = getProp(comp, "DURATION");
      // DTSTART/DTEND must be DATE-TIME, not DATE
      if (dtstart && dtstart.params["VALUE"] === "DATE") {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY DTSTART must be DATE-TIME" };
      }
      if (dtend && dtend.params["VALUE"] === "DATE") {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY DTEND must be DATE-TIME" };
      }
      // DTEND and DURATION mutually exclusive
      if (dtend && duration) {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY cannot have both DTEND and DURATION" };
      }
      // DURATION requires DTSTART
      if (duration && !dtstart) {
        return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY DURATION requires DTSTART" };
      }
      // DTEND must not precede DTSTART
      if (dtstart && dtend) {
        const start = parseDateTime(dtstart.value, dtstart.params);
        const end = parseDateTime(dtend.value, dtend.params);
        if (start && end && end < start) {
          return { code: 400, precondition: "valid-calendar-data", message: "VAVAILABILITY DTEND must not precede DTSTART" };
        }
      }
      // AVAILABLE sub-components
      for (const avail of getComps(comp, "AVAILABLE")) {
        if (!getProp(avail, "UID")) {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE UID is required" };
        }
        if (!getProp(avail, "DTSTAMP")) {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE DTSTAMP is required" };
        }
        const aStart = getProp(avail, "DTSTART");
        if (!aStart) {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE DTSTART is required" };
        }
        if (aStart.params["VALUE"] === "DATE") {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE DTSTART must be DATE-TIME" };
        }
        const aEnd = getProp(avail, "DTEND");
        if (aEnd && aEnd.params["VALUE"] === "DATE") {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE DTEND must be DATE-TIME" };
        }
        const aDur = getProp(avail, "DURATION");
        if (aEnd && aDur) {
          return { code: 400, precondition: "valid-calendar-data", message: "AVAILABLE cannot have both DTEND and DURATION" };
        }
      }
    }
    // Return early — VAVAILABILITY objects skip VEVENT/VTODO validation
    return null;
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

  // Per-component validation
  for (const comp of components) {
    // VEVENT-specific checks
    if (comp.name === "VEVENT") {
      // For METHOD:CANCEL, validate SEQUENCE >= 1 and STATUS constraints
      if (isCancel) {
        const seq = getProp(comp, "SEQUENCE");
        const seqVal = seq ? parseInt(seq.value, 10) : 0;
        if (!seq || seqVal < 1) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "CANCEL VEVENT must have SEQUENCE >= 1",
          };
        }
        const status = getProp(comp, "STATUS");
        if (status && status.value !== "CANCELLED") {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "CANCEL VEVENT STATUS must be CANCELLED if present",
          };
        }
        // Skip DTSTART requirement for CANCEL
      } else {
        // DTSTART is required for non-CANCEL VEVENT
        if (!getProp(comp, "DTSTART")) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "DTSTART is required in VEVENT",
          };
        }
        // PARTSTAT=PARTIAL is only valid for VTODO (RFC 5546 §3.4.3)
        for (const attendee of getProps(comp, "ATTENDEE")) {
          if (attendee.params["PARTSTAT"]?.toUpperCase() === "PARTIAL") {
            return {
              code: 400,
              precondition: "valid-calendar-data",
              message: "ATTENDEE PARTSTAT=PARTIAL is not valid in VEVENT",
            };
          }
        }
      }

      // Cannot have both DTEND and DURATION
      if (getProp(comp, "DTEND") && getProp(comp, "DURATION")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VEVENT cannot have both DTEND and DURATION",
        };
      }

      // DTEND type must match DTSTART type; DTEND must not precede DTSTART
      const dtstartProp = getProp(comp, "DTSTART");
      const dtendProp = getProp(comp, "DTEND");
      if (dtstartProp && dtendProp) {
        if (getValueType(dtstartProp) !== getValueType(dtendProp)) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VEVENT DTEND value type must match DTSTART value type",
          };
        }
        const dtStartDate = parseDateTime(dtstartProp.value, dtstartProp.params);
        const dtEndDate = parseDateTime(dtendProp.value, dtendProp.params);
        if (dtStartDate && dtEndDate && dtEndDate < dtStartDate) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VEVENT DTEND must not precede DTSTART",
          };
        }
      }

      // STATUS values restricted to TENTATIVE, CONFIRMED, CANCELLED
      const status = getProp(comp, "STATUS");
      if (status && !["TENTATIVE", "CONFIRMED", "CANCELLED"].includes(status.value)) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: `Invalid VEVENT STATUS value: ${status.value}`,
        };
      }
    }

    // VTODO-specific checks
    if (comp.name === "VTODO") {
      // For METHOD:CANCEL, validate SEQUENCE >= 1 and STATUS constraints
      if (isCancel) {
        const seq = getProp(comp, "SEQUENCE");
        const seqVal = seq ? parseInt(seq.value, 10) : 0;
        if (!seq || seqVal < 1) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "CANCEL VTODO must have SEQUENCE >= 1",
          };
        }
        const status = getProp(comp, "STATUS");
        if (status && status.value !== "CANCELLED") {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "CANCEL VTODO STATUS must be CANCELLED if present",
          };
        }
      }

      // Cannot have both DUE and DURATION
      if (getProp(comp, "DUE") && getProp(comp, "DURATION")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VTODO cannot have both DUE and DURATION",
        };
      }

      // DURATION requires DTSTART
      if (getProp(comp, "DURATION") && !getProp(comp, "DTSTART")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VTODO DURATION requires DTSTART",
        };
      }

      // DUE type must match DTSTART type; DUE must not precede DTSTART
      const dtstartProp = getProp(comp, "DTSTART");
      const dueProp = getProp(comp, "DUE");
      if (dtstartProp && dueProp) {
        if (getValueType(dtstartProp) !== getValueType(dueProp)) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VTODO DUE value type must match DTSTART value type",
          };
        }
        const dtStartDate = parseDateTime(dtstartProp.value, dtstartProp.params);
        const dueDate = parseDateTime(dueProp.value, dueProp.params);
        if (dtStartDate && dueDate && dueDate < dtStartDate) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VTODO DUE must not precede DTSTART",
          };
        }
      }

      // STATUS values restricted to NEEDS-ACTION, COMPLETED, IN-PROCESS, CANCELLED
      const status = getProp(comp, "STATUS");
      if (status && !["NEEDS-ACTION", "COMPLETED", "IN-PROCESS", "CANCELLED"].includes(status.value)) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: `Invalid VTODO STATUS value: ${status.value}`,
        };
      }

      // COMPLETED must be UTC
      const completed = getProp(comp, "COMPLETED");
      if (completed && !isUTCDateTime(completed.value)) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VTODO COMPLETED must be a UTC DATE-TIME",
        };
      }
    }

    // Checks for all components (VEVENT and VTODO)

    // DTSTAMP is required and must be UTC
    const dtstamp = getProp(comp, "DTSTAMP");
    if (!dtstamp) {
      return {
        code: 400,
        precondition: "valid-calendar-data",
        message: `DTSTAMP is required in ${comp.name}`,
      };
    }
    if (!isUTCDateTime(dtstamp.value)) {
      return {
        code: 400,
        precondition: "valid-calendar-data",
        message: `DTSTAMP must be a UTC DATE-TIME in ${comp.name}`,
      };
    }

    // CREATED must be UTC (if present)
    const created = getProp(comp, "CREATED");
    if (created && !isUTCDateTime(created.value)) {
      return {
        code: 400,
        precondition: "valid-calendar-data",
        message: `CREATED must be a UTC DATE-TIME in ${comp.name}`,
      };
    }

    // PRIORITY must be 0-9 integer (if present)
    const priority = getProp(comp, "PRIORITY");
    if (priority) {
      const pval = parseInt(priority.value, 10);
      if (isNaN(pval) || pval < 0 || pval > 9 || String(pval) !== priority.value) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: `PRIORITY must be an integer 0-9 in ${comp.name}`,
        };
      }
    }

    // PERCENT-COMPLETE must be 0-100 integer (if present)
    const pct = getProp(comp, "PERCENT-COMPLETE");
    if (pct) {
      const pval = parseInt(pct.value, 10);
      if (isNaN(pval) || pval < 0 || pval > 100 || String(pval) !== pct.value) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: `PERCENT-COMPLETE must be an integer 0-100 in ${comp.name}`,
        };
      }
    }

    // Duplicate RRULE not allowed
    if (getProps(comp, "RRULE").length > 1) {
      return {
        code: 400,
        precondition: "valid-calendar-data",
        message: `Duplicate RRULE not allowed in ${comp.name}`,
      };
    }

    // Multiple REQUEST-STATUS must share the same top-level numeric class (RFC 5546 §3.6)
    const reqStatuses = getProps(comp, "REQUEST-STATUS");
    if (reqStatuses.length > 1) {
      const classes = new Set(reqStatuses.map((rs) => rs.value.split(".")[0]));
      if (classes.size > 1) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "Multiple REQUEST-STATUS must share the same top-level numeric class",
        };
      }
    }

    // VALARM checks
    for (const alarm of getComps(comp, "VALARM")) {
      // ACTION required
      const action = getProp(alarm, "ACTION");
      if (!action) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VALARM ACTION is required",
        };
      }

      // TRIGGER required
      if (!getProp(alarm, "TRIGGER")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VALARM TRIGGER is required",
        };
      }

      // ACTION:DISPLAY → DESCRIPTION required
      if (action.value === "DISPLAY" && !getProp(alarm, "DESCRIPTION")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VALARM ACTION:DISPLAY requires DESCRIPTION",
        };
      }

      // ACTION:EMAIL → DESCRIPTION, SUMMARY, and ATTENDEE all required
      if (action.value === "EMAIL") {
        if (!getProp(alarm, "DESCRIPTION")) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VALARM ACTION:EMAIL requires DESCRIPTION",
          };
        }
        if (!getProp(alarm, "SUMMARY")) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VALARM ACTION:EMAIL requires SUMMARY",
          };
        }
        if (!getProp(alarm, "ATTENDEE")) {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: "VALARM ACTION:EMAIL requires ATTENDEE",
          };
        }
      }

      // REPEAT present → DURATION must also be present
      if (getProp(alarm, "REPEAT") && !getProp(alarm, "DURATION")) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "VALARM REPEAT requires DURATION",
        };
      }
    }

    // RFC 9253 §6.1/§8.2: LINK property requires both LINKREL and VALUE parameters
    for (const link of getProps(comp, "LINK")) {
      if (!link.params["LINKREL"]) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "LINK property MUST include LINKREL parameter (RFC 9253 §6.1)",
        };
      }
      if (!link.params["VALUE"]) {
        return {
          code: 400,
          precondition: "valid-calendar-data",
          message: "LINK property MUST include VALUE parameter (RFC 9253 §8.2)",
        };
      }
    }

    // RFC 9253 §9.1: RELATED-TO with RELTYPE=PARENT/CHILD/SIBLING must use VALUE=UID
    const parentChildSiblingTypes = new Set(["PARENT", "CHILD", "SIBLING"]);
    for (const rel of getProps(comp, "RELATED-TO")) {
      const reltype = rel.params["RELTYPE"]?.toUpperCase();
      if (reltype && parentChildSiblingTypes.has(reltype)) {
        const valueType = rel.params["VALUE"]?.toUpperCase();
        if (valueType && valueType !== "UID") {
          return {
            code: 400,
            precondition: "valid-calendar-data",
            message: `RELATED-TO;RELTYPE=${reltype} requires VALUE=UID (RFC 9253 §9.1)`,
          };
        }
      }
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

/** Returns true if the ics string matches the CalDAV comp-filter tree.
 *  tzOffsetMs: UTC offset in ms of the collection timezone used to interpret floating times. */
export function matchesFilter(ics: string, filter: CompFilter, tzOffsetMs = 0): boolean {
  try {
    const cal = parseICS(ics);
    return matchComp(filter, cal, tzOffsetMs);
  } catch {
    return false;
  }
}

function matchComp(filter: CompFilter, comp: ICalComponent, tzOffsetMs: number): boolean {
  // The comp must match by name (case-insensitive)
  if (comp.name !== filter.name.toUpperCase()) {
    return filter.isNotDefined;
  }

  // time-range on the comp itself
  if (filter.start || filter.end) {
    if (!matchCompTimeRange(filter.start, filter.end, comp, tzOffsetMs)) return false;
  }

  // All nested comp-filters must match at least one child
  for (const cf of filter.comps) {
    if (!matchCompFilter(cf, comp, tzOffsetMs)) return false;
  }

  // All prop-filters must match
  for (const pf of filter.props) {
    if (!matchPropFilter(pf, comp)) return false;
  }

  return true;
}

function matchCompFilter(filter: CompFilter, parent: ICalComponent, tzOffsetMs: number): boolean {
  const children = parent.children.filter((c) => c.name === filter.name.toUpperCase());
  if (children.length === 0) return filter.isNotDefined;
  if (filter.isNotDefined) return false; // component IS defined → is-not-defined fails

  for (const child of children) {
    if (matchComp(filter, child, tzOffsetMs)) return true;
  }
  return false;
}

// Parse a TZOFFSETTO/TZOFFSETFROM string (+HHMM or -HHMM) to milliseconds.
function parseTzOffsetStr(s: string): number {
  const sign = s[0] === "-" ? -1 : 1;
  const h = parseInt(s.slice(1, 3), 10);
  const m = parseInt(s.slice(3, 5), 10);
  return sign * (h * 60 + m) * 60 * 1000;
}

// Extract UTC offset in ms from a raw VTIMEZONE ICS string (uses first TZOFFSETTO found).
export function extractTzOffsetFromVTZ(tzICS: string): number {
  const m = tzICS.match(/TZOFFSETTO:([+-]\d{4})/);
  return m ? parseTzOffsetStr(m[1]) : 0;
}

// Check if RRULE occurrences of an event overlap the given range (basic FREQ expansion).
function hasRecurrenceInRange(
  dtStart: Date,
  rruleStr: string,
  rangeStart: Date,
  rangeEnd: Date,
  durationMs: number,
): boolean {
  const params: Record<string, string> = {};
  for (const part of rruleStr.split(";")) {
    const eq = part.indexOf("=");
    if (eq >= 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  const freq = params["FREQ"]?.toUpperCase();
  const interval = params["INTERVAL"] ? parseInt(params["INTERVAL"], 10) : 1;
  const maxCount = params["COUNT"] ? parseInt(params["COUNT"], 10) : 500;

  let stepMs: number;
  switch (freq) {
    case "DAILY": stepMs = 86400000 * interval; break;
    case "WEEKLY": stepMs = 7 * 86400000 * interval; break;
    case "MONTHLY": stepMs = 30 * 86400000 * interval; break; // approximate
    case "YEARLY": stepMs = 365 * 86400000 * interval; break; // approximate
    default: return false;
  }

  let cur = dtStart.getTime();
  for (let n = 0; n < maxCount; n++) {
    const occStart = cur;
    if (occStart >= rangeEnd.getTime()) break; // past query range
    const occEnd = occStart + durationMs;
    if (occEnd > rangeStart.getTime()) return true; // overlaps
    cur += stepMs;
  }
  return false;
}

function matchCompTimeRange(
  start: Date | undefined,
  end: Date | undefined,
  comp: ICalComponent,
  tzOffsetMs: number,
): boolean {
  const rangeStart = start ?? new Date(0);
  const rangeEnd = end ?? new Date(8.64e15);

  // VAVAILABILITY: RFC 7953 §7.2.2 — unbounded DTSTART/DTEND are allowed
  if (comp.name === "VAVAILABILITY") {
    const dtStart = getPropDate(comp, "DTSTART");
    const dtEnd = getPropDate(comp, "DTEND");
    const windowStart = dtStart ?? new Date(0);
    const windowEnd = dtEnd ?? new Date(8.64e15);
    return windowStart < rangeEnd && windowEnd > rangeStart;
  }

  // VALARM: match by absolute TRIGGER date-time (RFC 4791 §7.8.5)
  if (comp.name === "VALARM") {
    const trigger = getProp(comp, "TRIGGER");
    if (!trigger) return false;
    const vtype = trigger.params["VALUE"]?.toUpperCase();
    if (vtype === "DATE-TIME") {
      const td = parseDateTime(trigger.value, trigger.params);
      if (!td) return false;
      return td >= rangeStart && td < rangeEnd;
    }
    // Duration-based TRIGGER requires parent DTSTART — not available here; skip
    return false;
  }

  // Helper: parse a date prop, applying tzOffsetMs if the value is floating
  const adjustedPropDate = (name: string): Date | null => {
    const p = getProp(comp, name);
    if (!p) return null;
    const d = parseDateTime(p.value, p.params);
    if (!d) return null;
    const floating = !p.value.endsWith("Z") && !p.params["TZID"] && p.value.length > 8;
    return floating && tzOffsetMs !== 0 ? new Date(d.getTime() - tzOffsetMs) : d;
  };

  const dtStart = adjustedPropDate("DTSTART");
  let dtEnd = adjustedPropDate("DTEND") ?? adjustedPropDate("DUE");

  if (!dtStart) return false;

  // If no DTEND/DUE, use DTSTART as end (for all-day or instant events)
  if (!dtEnd) {
    dtEnd = new Date(dtStart.getTime() + 24 * 60 * 60 * 1000);
  }

  // Direct overlap check
  if (dtStart < rangeEnd && dtEnd > rangeStart) return true;

  // RFC 4791 §7.4: if master doesn't overlap, expand RRULE and check occurrences
  const rruleProp = getProp(comp, "RRULE");
  if (rruleProp) {
    const durationMs = Math.max(0, dtEnd.getTime() - dtStart.getTime());
    if (hasRecurrenceInRange(dtStart, rruleProp.value, rangeStart, rangeEnd, durationMs)) return true;
  }

  return false;
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
