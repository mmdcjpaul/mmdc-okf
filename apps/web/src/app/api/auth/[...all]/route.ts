import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/** Sign-in: provider callbacks, the email link, and sign-out. Open to signed-out people. */
const handler = toNextJsHandler((request: Request) => auth().handler(request));

export const { GET, POST } = handler;
