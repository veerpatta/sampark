/**
 * Turning a batch's links into the messages the office actually sends.
 *
 * A marks round fans out to thirty-eight links across about sixteen teachers —
 * Prateek alone takes three, one per subject. Handing them over one at a time
 * is thirty-eight app switches for what is really sixteen conversations, so the
 * send queue groups them and sends one message per recipient.
 *
 * PURE, AND WITH NO DATABASE IMPORT. Its output is what a "use client"
 * component renders, and lib/db.ts's header says that module must never be
 * imported from one — so this cannot live in lib/batches.ts without dragging
 * the driver into the browser bundle. The grouping is still done on the server,
 * in the batch page; this file only has to be safe if that ever changes.
 */

export type QueueLink = {
  requestId: string;
  token: string;
  audienceKind: string;
  audienceLabel: string;
  fieldKeys: string[];
  /** Classes the frozen roster covers. Named in the message when there is >1. */
  classLabels: string[];
  teacherId: string;
  teacherName: string;
  /** The number this link is going to: her saved one, or the override. */
  teacherPhone: string;
  /** Set only when the office typed a number for THIS request. */
  contactPhone: string | null;
  /** Her durable page, when she has one. */
  teacherLinkToken: string | null;
  rosterSize: number;
  sent: boolean;
};

/**
 * A batch's links, in the shape the queue groups.
 *
 * This mapping used to live inline in the batch page. It moved here the day a
 * second caller needed it — the API send rebuilds the same card on the server
 * from the batch id, and the message it sends must be built from exactly the
 * links the card shows. Two copies of one mapping is how a card and its
 * message come to disagree about which links she holds.
 *
 * Typed structurally rather than against BatchLink, so this file keeps its
 * "no database import" promise.
 */
export function toQueueLinks(
  links: {
    requestId: string;
    token: string;
    audienceKind: string;
    audienceLabel: string;
    fieldKeys: string[];
    classLabels: string[];
    teacherId: string;
    teacherName: string;
    teacherPhone: string;
    contactPhone: string | null;
    teacherLinkToken: string | null;
    rosterSize: number;
    sentAt: Date | null;
  }[],
): QueueLink[] {
  return links.map((link) => ({
    requestId: link.requestId,
    token: link.token,
    audienceKind: link.audienceKind,
    audienceLabel: link.audienceLabel,
    fieldKeys: link.fieldKeys,
    classLabels: link.classLabels,
    teacherId: link.teacherId,
    teacherName: link.teacherName,
    teacherPhone: link.teacherPhone,
    contactPhone: link.contactPhone,
    teacherLinkToken: link.teacherLinkToken,
    rosterSize: link.rosterSize,
    sent: link.sentAt !== null,
  }));
}

export type QueueGroup = {
  /** `${teacherId}|${phone}`. Stable across a render and safe as a React key. */
  key: string;
  teacherId: string;
  teacherName: string;
  /** The one number this card's message goes to. */
  phone: string;
  /** True when this card exists only because the office overrode the number. */
  overridden: boolean;
  /**
   * Her durable page token, when she has one.
   *
   * The message appends it, so the first delivery of a personal link costs no
   * extra send — it rides along with a round she is about to do anyway, which
   * is the only moment she will actually save it.
   */
  linkToken: string | null;
  links: QueueLink[];
  /** Every link on the card has been handed over. */
  sent: boolean;
  /** How many are already ticked. Only ever partial — see below. */
  sentCount: number;
  /** Children across all of her links, for the sub-line. */
  students: number;
};

/**
 * One card per (teacher, number), links in the order the fan-out made them.
 *
 * KEYED BY ID AND NUMBER, NEVER BY NAME. Two teachers can share a name — the id
 * is typed by the office and the name is free text — and, more importantly, a
 * link carrying a contact_phone override is deliberately going somewhere else:
 * she is on leave and her sister is covering that one section. Folding that
 * into her saved-number card would send it to the wrong phone, which is the
 * single failure requests.contact_phone exists to prevent. So an overridden
 * link gets its own card, labelled with the number it is actually going to.
 *
 * Group order follows each group's FIRST link, so the queue reads in the order
 * it was created and a Resume appends rather than reshuffling the list under
 * somebody's thumb.
 */
export function groupLinksByRecipient(links: QueueLink[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();

  for (const link of links) {
    const key = `${link.teacherId}|${link.teacherPhone}`;
    const group = groups.get(key) ?? {
      key,
      teacherId: link.teacherId,
      teacherName: link.teacherName,
      phone: link.teacherPhone,
      overridden: Boolean(link.contactPhone),
      linkToken: link.teacherLinkToken,
      links: [],
      sent: false,
      sentCount: 0,
      students: 0,
    };
    group.links.push(link);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    /**
     * `every`, not `some`, and the difference is a real state.
     *
     * A partially-sent card is NOT reachable by sending — the message carries
     * all of her links at once. It happens when a Resume adds a link to a
     * teacher who was already ticked, or when the office unticks one. Both
     * mean the message she received did not cover everything, so she belongs
     * back in the queue. (This is why the partial branch in SendQueue is not
     * dead code.)
     */
    sent: group.links.every((link) => link.sent),
    sentCount: group.links.filter((link) => link.sent).length,
    students: group.links.reduce((sum, link) => sum + link.rosterSize, 0),
  }));
}
