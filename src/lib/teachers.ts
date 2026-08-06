/**
 * Which teacher owns this class.
 *
 * The rule itself now lives in lib/ownership.ts, generalised to houses and bus
 * routes so a bulk send can resolve any scope. These two are kept as the
 * class-shaped front door: the quick send and the request builder only ever ask
 * about a class, and reading `chooseTeacherForClass(teachers, "Class 8")` at
 * those call sites beats reading a scope object built inline.
 *
 * One rule, two spellings — never two rules.
 */

import {
  chooseTeacherForScope,
  partitionByScope,
  type TeacherChoice,
  type TeacherLike,
} from "./ownership";

export type { TeacherChoice, TeacherLike };

export function chooseTeacherForClass(
  teachers: TeacherLike[],
  classLabel: string,
): TeacherChoice {
  return chooseTeacherForScope(teachers, { kind: "class", value: classLabel });
}

/** Owners first, then everyone else. */
export function partitionByClass(
  teachers: TeacherLike[],
  classLabel: string,
): { owners: TeacherLike[]; others: TeacherLike[] } {
  return partitionByScope(teachers, { kind: "class", value: classLabel });
}
