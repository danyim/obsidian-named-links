/**
 * Keeps a titled paste to two undo steps: the first takes the link back to
 * the URL as it was pasted, the second takes the paste away.
 *
 * The plugin inserts placeholders straight away and swaps in titles later.
 * Made as plain edits, each swap is a step of its own, so undoing it brings
 * the placeholder back with nothing left to replace it. Keeping the swap out
 * of the history doesn't help either: CodeMirror then treats the title as a
 * concurrent insertion, and undoing the paste leaves the link behind.
 *
 * So the paste is made as its own history event, and when a title arrives
 * while the note is exactly as the plugin left it, that event is undone and
 * the history is written again as it should read: one event inserting the
 * URLs as pasted, then one turning them into titled links. A placeholder
 * still waiting for its title is part of the first event until it resolves.
 *
 * If anything changed the note in between, the placeholder is turned into
 * the pasted URL and then into the titled link as two steps made on top of
 * that change, so undo still passes through the URL. Undoing past that
 * shows the placeholder again, since the paste is no longer the most recent
 * thing to undo.
 */
import { isolateHistory, redo, undo } from '@codemirror/commands';
import {
  ChangeSet,
  ChangeSpec,
  EditorSelection,
  Text,
  Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Editor, EditorChange } from 'obsidian';

export interface TrackedLink {
  /** The placeholder link as inserted. */
  link: string;
  /** What the user had there, or pasted: the URL the first undo returns. */
  fallback: string;
}

interface Item extends TrackedLink {
  /** Unset while pending; the titled link, or null when none was found. */
  result?: string | null;
}

interface TrackedChange {
  /** Offsets into `startDoc`. */
  from: number;
  to: number;
  /** The inserted text, split at each placeholder link it holds. */
  pieces: (string | Item)[];
}

interface Insertion {
  /** The note before the insertion. */
  startDoc: Text;
  changes: TrackedChange[];
  items: Item[];
  /** How many of the plugin's own events are on top of the history. */
  pushed: number;
  /** The note right after the plugin's last change for this insertion. */
  lastDoc: Text;
  userEvent: string;
}

// Only the most recent insertion in an editor can be on top of its undo
// history, so one per editor is all that is worth remembering.
const insertions = new WeakMap<EditorView, Insertion>();

function viewOf(editor: Editor): EditorView | null {
  return (editor as Editor & { cm?: EditorView }).cm ?? null;
}

function split(insert: string, items: Item[]): (string | Item)[] {
  const found = items
    .map((item) => ({ item, at: insert.indexOf(item.link) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const pieces: (string | Item)[] = [];
  let last = 0;
  for (const { item, at } of found) {
    if (at > last) pieces.push(insert.slice(last, at));
    pieces.push(item);
    last = at + item.link.length;
  }
  if (last < insert.length) pieces.push(insert.slice(last));
  return pieces;
}

function track(
  view: EditorView,
  changes: { from: number; to: number; insert: string }[],
  links: TrackedLink[],
  userEvent: string,
  selection?: EditorSelection
): void {
  const startDoc = view.state.doc;
  // Isolated on both sides, so typing just before the insertion isn't undone
  // with it, and typing just after isn't folded into it.
  const tr = view.state.update({
    changes,
    selection,
    annotations: isolateHistory.of('full'),
    userEvent,
    scrollIntoView: true,
  });
  view.dispatch(tr);

  const items: Item[] = links.map((link) => ({ ...link }));
  if (items.length === 0 || view.state.doc !== tr.newDoc) {
    // Nothing will arrive later, or something else changed the note in the
    // same update and the event is no longer the plugin's alone.
    insertions.delete(view);
    return;
  }
  insertions.set(view, {
    startDoc,
    changes: changes.map((c) => ({
      from: c.from,
      to: c.to,
      pieces: split(c.insert, items),
    })),
    items,
    pushed: 1,
    lastDoc: view.state.doc,
    userEvent,
  });
}

/**
 * Replaces the selection with `text` as an undo event of its own, tracking
 * the placeholder links in it. Returns false if the editor isn't CodeMirror,
 * for the caller to fall back on.
 */
export function insertTracked(
  editor: Editor,
  text: string,
  links: TrackedLink[]
): boolean {
  const view = viewOf(editor);
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  track(
    view,
    [{ from, to, insert: text }],
    links,
    'input.paste',
    EditorSelection.single(from + text.length)
  );
  return true;
}

/** Makes `changes` as one undo event, like `insertTracked`. */
export function changeTracked(
  editor: Editor,
  changes: EditorChange[],
  links: TrackedLink[]
): boolean {
  const view = viewOf(editor);
  if (!view) return false;
  const specs = changes
    .map((change) => ({
      from: editor.posToOffset(change.from),
      to: editor.posToOffset(change.to ?? change.from),
      insert: change.text,
    }))
    .sort((a, b) => a.from - b.from);
  track(view, specs, links, 'input');
  return true;
}

function dispatchStep(view: EditorView, changes: ChangeSpec): void {
  view.dispatch({
    changes,
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
  });
}

/**
 * Puts the outcome of a lookup in place of the placeholder link at
 * `from`..`to`: `titled`, or the `fallback` URL when no title was found.
 */
export function finishPlaceholder(
  editor: Editor,
  from: number,
  to: number,
  fallback: string,
  titled: string | null
): void {
  const view = viewOf(editor);
  if (!view) {
    editor.replaceRange(
      titled ?? fallback,
      editor.offsetToPos(from),
      editor.offsetToPos(to)
    );
    return;
  }
  if (rewriteHistory(view, from, to, titled)) return;

  dispatchStep(view, { from, to, insert: fallback });
  if (titled !== null) {
    dispatchStep(view, { from, to: from + fallback.length, insert: titled });
  }
}

/**
 * Rewrites the insertion's history with the placeholder at `from`..`to`
 * resolved. Returns false, changing nothing, when the note isn't as the
 * insertion left it.
 */
function rewriteHistory(
  view: EditorView,
  from: number,
  to: number,
  titled: string | null
): boolean {
  const insertion = insertions.get(view);
  if (!insertion) return false;
  // Compared by identity: any change at all since, by the user or anything
  // else, makes a new document.
  if (view.state.doc !== insertion.lastDoc) {
    insertions.delete(view);
    return false;
  }
  const link = insertion.lastDoc.sliceString(from, to);
  const item = insertion.items.find(
    (i) => i.result === undefined && i.link === link
  );
  if (!item) return false;

  // Where the cursor is now, carried over the change, rather than where it
  // was before the paste, which is where the undo below leaves it.
  const finished = ChangeSet.of(
    { from, to, insert: titled ?? item.fallback },
    insertion.lastDoc.length
  );
  const selection = view.state.selection.map(finished);
  const scroll = view.scrollSnapshot();

  let undone = 0;
  while (undone < insertion.pushed && undo(view)) undone++;
  if (undone < insertion.pushed || !view.state.doc.eq(insertion.startDoc)) {
    // The plugin's events weren't on top of the history after all.
    for (let i = 0; i < undone; i++) redo(view);
    insertions.delete(view);
    return false;
  }
  item.result = titled;

  // The first event inserts every resolved URL as it was pasted and every
  // pending one as its placeholder; the second titles the resolved ones.
  const pasted: { from: number; to: number; insert: string }[] = [];
  const titling: { from: number; to: number; insert: string }[] = [];
  let shift = 0;
  for (const change of insertion.changes) {
    const at = change.from + shift;
    let insert = '';
    for (const piece of change.pieces) {
      if (typeof piece === 'string') {
        insert += piece;
      } else if (piece.result === undefined) {
        insert += piece.link;
      } else {
        if (piece.result !== null) {
          const start = at + insert.length;
          titling.push({
            from: start,
            to: start + piece.fallback.length,
            insert: piece.result,
          });
        }
        insert += piece.fallback;
      }
    }
    // Enhancing a URL inserts what was already there, which is no event.
    if (insert !== insertion.startDoc.sliceString(change.from, change.to)) {
      pasted.push({ from: change.from, to: change.to, insert });
    }
    shift += insert.length - (change.to - change.from);
  }

  let pushed = 0;
  if (pasted.length > 0) {
    const changes = ChangeSet.of(pasted, insertion.startDoc.length);
    view.dispatch({
      changes,
      // With a title to follow, the cursor goes after the pasted URLs, which
      // is where undoing the title leaves it.
      selection:
        titling.length > 0 ? view.state.selection.map(changes, 1) : selection,
      effects: titling.length > 0 ? [] : scroll,
      annotations: isolateHistory.of('full'),
      userEvent: insertion.userEvent,
    });
    pushed++;
  }
  if (titling.length > 0) {
    view.dispatch({
      changes: titling,
      selection,
      // The undo scrolled to the selection it restored; stay where the
      // reader is instead.
      effects: scroll,
      annotations: isolateHistory.of('full'),
      userEvent: 'input',
    });
    pushed++;
  }
  if (pushed === 0) {
    view.dispatch({
      selection,
      effects: scroll,
      annotations: Transaction.addToHistory.of(false),
    });
  }

  if (insertion.items.every((i) => i.result !== undefined)) {
    insertions.delete(view);
  } else {
    insertion.pushed = pushed;
    insertion.lastDoc = view.state.doc;
  }
  return true;
}
