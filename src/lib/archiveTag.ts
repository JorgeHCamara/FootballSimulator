/** The tag of a league's past-round odds report entries and of the pages that read them (src/lib/oddsArchive.ts): expire it to correct them all. On its own, so the revalidation route can expire it without loading the reports. */
export const archiveTag = (code: string) => `odds-archive:${code}`;
