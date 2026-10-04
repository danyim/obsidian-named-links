/**
 * Notices vim's `p` and `P` putting text into an editor (upstream #7). A put
 * inserts the register's text directly, without a paste event, so it never
 * reaches the plugin's paste handler.
 *
 * Obsidian's vim mode is CodeMirror's vim emulation, reached through the
 * CodeMirror 5 style adapter it keeps on the editor's view as `cm`. For a
 * key that completes a command, the adapter signals `vim-command-done`, then
 * dispatches the command's edits as its operation ends, then signals
 * `vim-keypress` with the key (seen the same way on Obsidian 1.13.4 and
 * 1.13.7). So when `p` arrives, the document changes made since the last
 * `vim-command-done` are exactly what the put inserted. Watching for that,
 * rather than taking over `p` with an action of our own, leaves vim's put
 * itself alone: registers, counts, `gp`, visual mode and user mappings all
 * work as they did.
 *
 * There is no vim mode on mobile, so this never fires there.
 */
import { ChangeSet } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

interface VimAdapter {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
  state?: { vim?: { insertMode?: boolean } };
}

/** Called with the range a put inserted, in the view's current document. */
export type PutHandler = (view: EditorView, from: number, to: number) => void;

export function vimPutWatcher(onPut: PutHandler) {
  return ViewPlugin.fromClass(
    class {
      private changes: ChangeSet | null = null;
      private adapter: VimAdapter | null = null;

      constructor(private view: EditorView) {
        this.attach();
      }

      update(update: ViewUpdate) {
        // The adapter appears when vim mode is turned on, after the view.
        this.attach();
        if (update.docChanged) {
          this.changes = this.changes
            ? this.changes.compose(update.changes)
            : update.changes;
        }
      }

      destroy() {
        this.detach();
      }

      private attach() {
        const adapter = (this.view as EditorView & { cm?: VimAdapter }).cm;
        if (!adapter || adapter === this.adapter) return;
        this.detach();
        this.adapter = adapter;
        adapter.on('vim-command-done', this.reset);
        adapter.on('vim-keypress', this.onKey);
      }

      private detach() {
        this.adapter?.off?.('vim-command-done', this.reset);
        this.adapter?.off?.('vim-keypress', this.onKey);
        this.adapter = null;
      }

      private reset = () => {
        this.changes = null;
      };

      private onKey = (key: unknown) => {
        const changes = this.changes;
        this.changes = null;
        if (key !== 'p' && key !== 'P') return;
        if (!changes || this.adapter?.state?.vim?.insertMode) return;

        // One put inserts in one place. Anything else, a blockwise put
        // across lines for one, is left as vim made it.
        const ranges: [number, number][] = [];
        changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          ranges.push([fromB, toB]);
        });
        if (ranges.length !== 1) return;
        const [from, to] = ranges[0];
        if (to > from) onPut(this.view, from, to);
      };
    }
  );
}
