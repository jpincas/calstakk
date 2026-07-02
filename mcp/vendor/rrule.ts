// Deno-only interop for the npm `rrule` package, mapped via the root deno.json
// import map. The web build resolves `rrule` from web/node_modules and never
// sees this file. rrule's CJS bundle defeats Deno's named-export detection and
// its ESM build uses extensionless internal imports Deno cannot load, so the
// named exports are re-exported by hand from the CJS namespace.
import rrule from 'rrule-npm'

export const RRule = rrule.RRule
export const RRuleSet = rrule.RRuleSet
export const rrulestr = rrule.rrulestr
export const Frequency = rrule.Frequency
export const Weekday = rrule.Weekday
export const ALL_WEEKDAYS = rrule.ALL_WEEKDAYS
export const datetime = rrule.datetime

export type RRule = InstanceType<typeof rrule.RRule>
export type RRuleSet = InstanceType<typeof rrule.RRuleSet>
export type Weekday = InstanceType<typeof rrule.Weekday>
