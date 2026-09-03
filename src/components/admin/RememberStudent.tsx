"use client";

import { useEffect } from "react";
import { RECENT_KEY, RECENT_MAX, readRecent, type RecentStudent } from "./RecentStudents";

/** Mounted on a student's page; renders nothing, records the visit. See RecentStudents. */
export function RememberStudent(student: RecentStudent) {
  useEffect(() => {
    try {
      const next = [student, ...readRecent().filter((row) => row.id !== student.id)].slice(0, RECENT_MAX);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private mode, quota, or storage switched off. Nothing to do.
    }
  }, [student.id, student.name, student.classLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
