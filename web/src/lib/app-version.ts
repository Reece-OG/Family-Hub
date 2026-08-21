// v4.9.1 — current app version. Read once at build time from the
// package.json so the runtime never has to do filesystem I/O.
//
// Next.js inlines a static JSON import like this at compile time, which
// is the convention the Next docs recommend for surfacing version
// strings into client components.

// eslint-disable-next-line @typescript-eslint/no-var-requires
import pkg from "../../package.json";

export const APP_VERSION: string = (pkg as { version: string }).version;
