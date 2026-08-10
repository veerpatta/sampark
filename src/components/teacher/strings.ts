/**
 * Every word the teacher surface says, in both languages, in one file.
 *
 * The screen used to be Hindi-only with the words written straight into the
 * JSX. It is now English first with the Hindi under it, and that only stays
 * consistent if the pair is a single object rather than two literals sitting
 * next to each other in a component — the second one is what rots.
 *
 * ENGLISH IS THE PRIMARY, HINDI IS THE SECOND LINE. Not a translation layer and
 * not a locale switch: both are always on screen. There is no `t()`, no
 * catalogue lookup, no missing-key fallback, because there is nothing to look
 * up — a `Phrase` is a value, and a component that renders one cannot fail to
 * find it.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. Dense recognition text — "SR 412",
 * "Father: Mangi Lal", a bus route, a sibling's number — stays English-only at
 * its call site. Those lines exist so she can tell one child from another at a
 * glance, and doubling their height is the opposite of that. The rule is:
 * anything she is asked to DO or is being TOLD is bilingual; anything she is
 * merely reading off to identify a child is not.
 *
 * The Hindi is written in the feminine throughout (भरती जाएँगी, कर सकती हैं).
 * That is deliberate — every class teacher who uses this is a woman — and it
 * stays that way.
 */

export type Phrase = { en: string; hi: string };

const p = (en: string, hi: string): Phrase => ({ en, hi });

export const T = {
  /* ------------------------------------------------------------ the row */
  reachedSchool: p("Sent to school", "विद्यालय पहुँच गया"),
  savedOnPhone: p("Saved on phone", "फ़ोन में सुरक्षित"),
  correct: p("Correct", "सही है"),
  change: p("Change", "बदलें"),
  lookAgain: p("Look again", "फिर से देखें"),
  statusPartial: p("Incomplete", "अधूरा"),
  statusChanged: p("Changed", "बदला गया"),
  statusAbsent: p("Not in class", "नहीं है"),
  nothingOnRecord: p("Nothing on record", "खाली है"),
  notFinished: p("Not finished yet", "अभी पूरा नहीं हुआ"),
  stillToFill: p("Still to fill", "यह अभी भरना बाकी है"),
  filled: (of: number, done: number) =>
    p(
      `${done} of ${of} filled — please fill the rest`,
      `${of} में से ${done} भरा — बाकी भी भर दें`,
    ),

  /* --------------------------------------------------------- the inputs */
  yes: p("Yes", "हाँ"),
  no: p("No", "नहीं"),
  chooseOne: p("— Select —", "— चुनें —"),
  chooseFromList: p("Choose one from the list", "सूची में से चुनें"),
  /** Placeholder text. One line only — a two-line placeholder is unreadable. */
  typeToSearch: "Type to search · टाइप करके ढूँढें",
  useThis: p("Use this", "लगाएँ"),
  sameAsLast: (value: string) => `Same as last: ${value}`,
  siblingNumber: (name: string, phone: string) => `${name}'s number: ${phone}`,
  numericHint: (n: number) => p(`Only numbers · ${n} digits`, `केवल नंबर · ${n} अंक`),

  /* ---------------------------------------------------------- the photo */
  photoLabel: p("Student photo", "बच्चे की फ़ोटो"),
  takePhoto: p("Take photo", "फ़ोटो लें"),
  retake: p("Take again", "फिर से लें"),
  fromGallery: p("Choose from gallery", "गैलरी से चुनें"),
  preparingPhoto: p("Preparing the photo…", "फ़ोटो तैयार हो रही है…"),
  sendingPhoto: (percent: number) =>
    p(`Sending… ${percent}%`, `भेजी जा रही है… ${percent}%`),
  photoWaiting: p(
    "On the phone — it will go when there is signal.",
    "फ़ोन में है — इंटरनेट आते ही चली जाएगी।",
  ),
  photoNotSaved: p(
    "This phone cannot hold the photo. Stay on this page until it is sent.",
    "यह फ़ोन फ़ोटो सहेज नहीं सकता। भेजे जाने तक इसी पेज पर रहें।",
  ),
  photoNoBulkConfirm: p(
    "Photos are confirmed one child at a time — please look at each face.",
    "फ़ोटो एक-एक करके ही देखनी है — हर चेहरा देखकर बताएँ।",
  ),
  photoQueueFull: p(
    "Several photos are waiting. Please connect before taking more.",
    "कई फ़ोटो बाकी हैं। और लेने से पहले इंटरनेट से जुड़ जाएँ।",
  ),

  /* ----------------------------------------------------------- the form */
  markedCorrect: (n: number) =>
    p(`Marked ${n} as correct`, `${n} पर सही का निशान लगाया`),
  undo: p("Undo", "वापस लें"),
  restored: p(
    "Your earlier work was saved on this phone — carry on from there.",
    "आपका पहले का काम फ़ोन में सुरक्षित था — वहीं से आगे बढ़ें।",
  ),
  offlineWorking: p(
    "No internet. Keep working — everything is saved on the phone and will be sent the moment you reconnect.",
    "इंटरनेट नहीं है। काम करती रहें — सब फ़ोन में सुरक्षित है और जुड़ते ही अपने आप भेज दिया जाएगा।",
  ),
  blanksHeading: (n: number) =>
    p(
      `${n} children have nothing on record — these matter most`,
      `${n} बच्चों की जानकारी नहीं है — ये सबसे ज़रूरी हैं`,
    ),
  fillMissingFirst: (n: number) =>
    p(`Fill ${n} missing details first`, `पहले ${n} जानकारी भरें`),
  checkExistingFirst: (n: number) =>
    p(`Check ${n} existing details`, `${n} जानकारी जाँचें`),
  savedAutomatically: p("Saved automatically", "अपने-आप सहेजा गया"),
  missingCount: (n: number) => p(`Missing ${n}`, `${n} बाकी`),
  allSet: p("All set", "पूरा"),
  fillDetails: p("Fill details", "जानकारी भरें"),
  knownHeading: (n: number) =>
    p(
      `${n} children already have details — please check and confirm`,
      `${n} बच्चों की जानकारी पहले से है — देखकर बता दें कि सही है`,
    ),
  knownHeadingShort: (n: number) =>
    p(`Check existing details (${n})`, `मौजूदा जानकारी जाँचें (${n})`),
  confirmAll: (n: number) => p(`All ${n} are correct`, `सब सही हैं (${n})`),
  everyoneSent: (n: number) =>
    p(
      `All ${n} children have reached the school`,
      `सब ${n} बच्चों की जानकारी विद्यालय पहुँच गई`,
    ),
  finish: p("Done", "पूरा हुआ"),
  showNext: (n: number, left: number) =>
    p(`Show next ${n} — ${left} more`, `अगले ${n} दिखाएँ — ${left} और बाकी`),

  /* ---------------------------------------------------------- the rail */
  allDone: p("All done", "सब पूरे हैं"),
  remaining: (n: number) => p(`${n} left`, `अभी ${n} बाकी हैं`),
  remainingShort: (n: number) => p(`${n} left`, `${n} बाकी`),
  sentCount: (n: number) =>
    p(`${n} reached the school`, `${n} विद्यालय पहुँच गए`),
  sentShort: (n: number) => p(`${n} at school`, `${n} विद्यालय में`),
  sending: p("Sending…", "भेजा जा रहा है…"),
  savedGoing: (n: number) =>
    p(
      `${n} saved on the phone, going by themselves`,
      `${n} फ़ोन में सुरक्षित, अपने आप जा रहे हैं`,
    ),
  answerFirst: p("Answer something first", "पहले जवाब दें"),
  review: (n: number) => p(`Check what you sent (${n})`, `देखें (${n})`),
  reviewAnswers: p("Review answers", "जवाब जाँचें"),
  onPhoneWillSend: p(
    "On phone · Sends online",
    "फ़ोन में · ऑनलाइन जाएगा",
  ),
  offlineKeepGoing: p(
    "No internet — keep working, it goes by itself when you reconnect.",
    "इंटरनेट नहीं है — काम करती रहें, जुड़ते ही अपने आप चला जाएगा।",
  ),

  /* -------------------------------------------------------- the receipt */
  receiptFilled: p("This is what you have filled", "आपने यह भरा है"),
  receiptSent: p("This is what you have sent", "आपने यह भेजा है"),
  backToList: p("Back to the list", "वापस सूची में"),
  receiptCounts: (total: number, sent: number, pending: number) =>
    p(
      `${sent} of ${total} children have reached the school` +
        (pending > 0 ? ` · ${pending} on the way` : ""),
      `कुल ${total} बच्चों में से · ${sent} विद्यालय पहुँच गए` +
        (pending > 0 ? ` · ${pending} जा रहे हैं` : ""),
    ),
  youChanged: (n: number) => p(`You changed ${n}`, `आपने ${n} बदले`),
  tapToFix: p("Tap to fix", "ठीक करने के लिए दबाएँ"),
  wasEmpty: p("was empty", "कुछ नहीं था"),
  youConfirmed: (n: number) =>
    p(`You confirmed ${n}`, `आपने ${n} की जानकारी सही बताई`),
  notInClassCount: (n: number) =>
    p(`${n} are not in this class`, `${n} बच्चे इस कक्षा में नहीं हैं`),
  partialCount: (n: number) =>
    p(
      n === 1
        ? "1 child still has a box empty"
        : `${n} children still have a box empty`,
      n === 1 ? "1 बच्चे की एक जानकारी बाकी है" : `${n} बच्चों की एक जानकारी बाकी है`,
    ),
  partialNote: p(
    "What you filled has already reached the school. Tap a name to finish the rest.",
    "आपने जो भरा वह विद्यालय पहुँच चुका है। बाकी नाम दबाकर पूरा कर दें।",
  ),
  untouchedCount: (n: number) =>
    p(
      n === 1 ? "1 child not answered yet" : `${n} children not answered yet`,
      n === 1 ? "1 बच्चे का जवाब बाकी है" : `${n} बच्चों का जवाब बाकी है`,
    ),
  untouchedNote: p(
    "You can still send the rest. Fill these in later.",
    "बाकी को अभी भी भेज सकती हैं। जो बचे हैं, बाद में भर दें।",
  ),
  sendNow: (n: number) => p(`Send now (${n})`, `अभी भेजें (${n})`),
  willGoWhenOnline: p(
    "It will go the moment you are online",
    "इंटरनेट आते ही चला जाएगा",
  ),
  nothingFilledYet: p("Nothing filled yet", "अभी कुछ भरा नहीं है"),
  allReached: p("Everything reached the school", "सब विद्यालय पहुँच गया"),
  filledAnswersReached: p(
    "All filled answers reached the school",
    "भरे हुए सभी जवाब विद्यालय पहुँच गए",
  ),
  offlineSafe: p(
    "No internet — everything is safe on the phone and goes when you reconnect.",
    "इंटरनेट नहीं है — सब फ़ोन में सुरक्षित है और जुड़ते ही चला जाएगा।",
  ),

  /* ------------------------------------------------------------ errors */
  linkDead: p(
    "This link no longer works. Please contact the office.",
    "यह लिंक अब काम नहीं कर रहा। कार्यालय से संपर्क करें।",
  ),
  tooFast: p(
    "A little slower — your work is safe and will go by itself.",
    "थोड़ा धीरे — आपका काम सुरक्षित है, अपने आप चला जाएगा।",
  ),
  someInvalid: p(
    "Something is not right. Look at the rows marked in red.",
    "कुछ जानकारी सही नहीं है। लाल निशान वाली पंक्तियाँ देखें।",
  ),
  sendFailed: p(
    "Sending failed. It will try again by itself.",
    "भेजने में दिक्कत हुई। अपने आप फिर कोशिश होगी।",
  ),

  /* -------------------------------------------------- the request page */
  dueBy: (date: string) => p(`by ${date}`, `${date} तक`),
  intro: p(
    "Children with nothing on record are at the top — fill those first. Everyone else already has details; if they are right, press All are correct once. Whatever you fill goes to the school by itself, and you can fix anything afterwards.",
    "जिन बच्चों की जानकारी नहीं है, वे सबसे ऊपर हैं — पहले वही भरें। बाकी सबकी जानकारी पहले से है; ठीक हो तो एक बार में सब सही हैं दबा दें। जो आप भरती जाएँगी वह अपने आप विद्यालय पहुँचता रहेगा — कुछ भी गलत हो जाए तो बाद में ठीक कर सकती हैं।",
  ),

  /* ----------------------------------------------------- the done page */
  thankYou: p("Thank you", "धन्यवाद"),
  sentToSchool: p(
    "Your answers have been sent to the school.",
    "आपकी जानकारी विद्यालय को भेज दी गई है।",
  ),
  seeListAgain: p("See the list again", "सूची फिर से देखें"),
  changeMore: p(
    "If you need to change anything, press above to go back.",
    "कुछ और बदलना हो तो ऊपर दबाकर वापस जा सकती हैं।",
  ),
  schoolName: p(
    "Shri Veer Patta Sr. Sec. School, Amet",
    "श्री वीर पत्ता उ. मा. विद्यालय, आमेट",
  ),

  /* ----------------------------------------------- the teacher's page */
  listsToFill: (n: number) => p(`${n} lists to fill`, `${n} सूची भरनी है`),
  nothingPending: p("Nothing pending", "अभी कुछ बाकी नहीं"),
  noListsYet: p("Nothing to fill right now.", "अभी कोई सूची बाकी नहीं है।"),
  noListsNote: p(
    "Whatever the school sends will appear here — keep this page saved.",
    "विद्यालय जब कुछ भेजेगा, वह यहीं दिखेगा — इस पेज को सहेज कर रखें।",
  ),
  pageIsYours: p(
    "This page is only for you. Please do not forward it.",
    "यह पेज सिर्फ़ आपके लिए है। किसी और को न भेजें।",
  ),
  listDone: p("Done", "पूरा हो गया"),
  listLeft: (n: number) => p(`${n} left`, `${n} बाकी`),
  overdue: p(
    "The date has passed — you can still fill it",
    "अंतिम तिथि निकल चुकी है — अभी भी भर सकती हैं",
  ),
  tooBusy: p("Please try again shortly.", "थोड़ी देर बाद कोशिश करें।"),
  tooBusyNote: p(
    "Your link is fine — just wait a minute.",
    "आपका लिंक ठीक है — बस एक मिनट रुक जाएँ।",
  ),
} as const;
