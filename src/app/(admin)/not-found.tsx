import Link from "next/link";
import { btn } from "@/components/ui/controls";
import { PageHeader } from "@/components/admin/PageHeader";

/**
 * A record that is not there.
 *
 * Reached from a stale link — a WhatsApp message about a child who has since
 * been re-keyed, a bookmark to a request that was deleted. The default page
 * said "404" in the middle of a white screen, which on a phone in a corridor
 * reads as the app being broken. This says what it is and where to go.
 */
export default function NotFound() {
  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        mobileTitle="content"
        title="Not on record"
        subtitle="There is nothing at this address. The link may be old, or the record it pointed at has been replaced."
      />
      <div className="flex flex-wrap gap-2">
        <Link href="/students" className={btn({ tone: "primary" })}>
          Find a student
        </Link>
        <Link href="/" className={btn()}>
          Dashboard
        </Link>
      </div>
    </div>
  );
}
