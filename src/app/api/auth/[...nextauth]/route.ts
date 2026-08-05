import { handlers } from "@/lib/auth/session";

/** Auth.js callback endpoints. Admin console only — teachers never log in. */
export const { GET, POST } = handlers;
