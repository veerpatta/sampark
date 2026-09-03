import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { listStudents } from "./students";
import { titleCaseName } from "./classes";

/**
 * One box that finds anything: a child, a request, a screen.
 *
 * The students board already searches children; what was missing was a way
 * to reach one from anywhere without going to the board first, and any way at
 * all to find a request by name. This is deliberately small — the first eight
 * children, the first five requests, and the pages whose name matches — and
 * the palette renders every hit as a real link, so a hit is one keypress from
 * open.
 */

export type SearchHit = {
  kind: "student" | "request" | "page";
  title: string;
  detail?: string;
  href: string;
};

export const MIN_QUERY = 2;

/** The screens a person might type the name of. Owner-only ones are filtered by the caller. */
export const PAGES: { label: string; href: string; keywords: string; settings?: boolean }[] = [
  { label: "Dashboard", href: "/", keywords: "home dashboard" },
  { label: "Students", href: "/students", keywords: "students board children list" },
  { label: "Add a student", href: "/students/new", keywords: "add new student admission" },
  { label: "Data health", href: "/students/health", keywords: "health completeness missing heatmap trend" },
  { label: "Import students", href: "/students/import", keywords: "import upload psp fee excel" },
  { label: "Requests", href: "/requests", keywords: "requests rounds board teachers progress" },
  { label: "New request", href: "/requests/new", keywords: "new request send link" },
  { label: "Send to many", href: "/requests/bulk", keywords: "bulk send many classes round" },
  { label: "Review", href: "/review", keywords: "review approve queue pending corrections" },
  { label: "Marks", href: "/marks", keywords: "marks fa exam board export" },
  { label: "Settings", href: "/settings", keywords: "settings", settings: true },
  { label: "Teachers", href: "/settings/teachers", keywords: "teachers phone links classes", settings: true },
  { label: "Field registry", href: "/settings/fields", keywords: "fields registry collect verify", settings: true },
  { label: "Subjects", href: "/settings/subjects", keywords: "subjects timetable who teaches", settings: true },
  { label: "Admin users", href: "/settings/users", keywords: "users accounts admin owner office", settings: true },
  { label: "Audit log", href: "/settings/audit", keywords: "audit log history changes", settings: true },
];

/** Pure, so the matcher is testable: a page matches on its label or its keywords. */
export function matchPages(query: string, includeSettings: boolean): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];
  return PAGES.filter((page) => includeSettings || !page.settings)
    .filter((page) => page.label.toLowerCase().includes(needle) || page.keywords.includes(needle))
    .map((page) => ({ kind: "page", title: page.label, href: page.href }));
}

export async function search(query: string, includeSettings: boolean): Promise<SearchHit[]> {
  const needle = query.trim();
  if (needle.length < MIN_QUERY) return [];

  const [students, requests] = await Promise.all([
    // Every status: the child who left last year is exactly the one whose
    // record somebody is trying to find.
    listStudents({ search: needle, statuses: ["*"], limit: 8 }),
    db
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        audienceLabel: schema.requests.audienceLabel,
        status: schema.requests.status,
        teacherName: schema.teachers.name,
      })
      .from(schema.requests)
      .innerJoin(schema.teachers, eq(schema.teachers.id, schema.requests.teacherId))
      .where(and(isNull(schema.requests.archivedAt), ilike(schema.requests.title, `%${needle}%`)))
      .orderBy(desc(schema.requests.createdAt))
      .limit(5),
  ]);

  return [
    ...students.students.map((student) => ({
      kind: "student" as const,
      title: titleCaseName(student.name),
      detail: [
        student.classLabel,
        student.rollNo ? `Roll ${student.rollNo}` : null,
        student.fatherName ? titleCaseName(student.fatherName) : null,
        student.phone,
        student.status !== "active" ? student.status : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/students/${encodeURIComponent(student.id)}`,
    })),
    ...requests.map((request) => ({
      kind: "request" as const,
      title: request.title,
      detail: `${request.audienceLabel} · ${request.teacherName} · ${request.status}`,
      href: `/requests/${request.id}`,
    })),
    ...matchPages(needle, includeSettings),
  ];
}
