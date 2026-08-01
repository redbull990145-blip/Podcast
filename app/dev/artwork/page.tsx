import { notFound } from "next/navigation";
import { ArtworkGallery } from "./gallery";

/**
 * The gallery is a development tool, not a page.
 *
 * It lives outside the `(app)` route group so it works without a session —
 * which is what makes it usable for looking at the renderer when auth is not
 * cooperating — and that same property would leave it public in production.
 * Nothing on it is sensitive, since it renders public podcast artwork and no
 * user data, but a debug surface anyone can reach is still a debug surface
 * anyone can reach.
 *
 * The guard is here, in a server component, rather than in a layout: Next's
 * generated route validator rejects a nested layout at this path, and a server
 * page wrapping the client gallery is the simpler shape anyway.
 */
export default function DevArtworkPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ArtworkGallery />;
}
