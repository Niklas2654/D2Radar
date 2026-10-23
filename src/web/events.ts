/** The web version's stand-in for Tauri's events: what the backend sends
 *  (bungie-update, oauth-changed, …) goes to the page's subscribers. */

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

export function emit(event: string, payload: unknown) {
  handlers.get(event)?.forEach((h) => h(payload));
}

export function on(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => set.delete(handler);
}
