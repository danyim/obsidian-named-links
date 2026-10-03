import { browser, expect } from '@wdio/globals';

import {
  editorText,
  editorValue,
  openNote,
  paste,
  resetPlugin,
  runCommand,
  setSettings,
  settled,
} from '../helpers';
import { fixtureBase, stopFixtureServer } from '../server';

function undo(): Promise<void> {
  return browser.executeObsidian(({ app, obsidian }) => {
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo();
  });
}

function redo(): Promise<void> {
  return browser.executeObsidian(({ app, obsidian }) => {
    app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.redo();
  });
}

function selection(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) =>
    app.workspace
      .getActiveViewOfType(obsidian.MarkdownView)!
      .editor.getSelection()
  );
}

/** Types `text` at the cursor as keyboard input does. */
async function type(text: string): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, text) => {
    const editor = app.workspace.getActiveViewOfType(
      obsidian.MarkdownView
    )!.editor;
    const cm = (editor as any).cm;
    const at = cm.state.selection.main.head;
    cm.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: 'input.type',
    });
  }, text);
}

// Every title here arrives well after the paste: CodeMirror merges an
// adjacent change made within half a second into the same undo step on its
// own, so a quick title would hide what the plugin does with the history.
describe('Undoing a titled paste', function () {
  let base: string;

  before(async function () {
    base = await fixtureBase();
  });

  after(async function () {
    await stopFixtureServer();
  });

  beforeEach(async function () {
    await resetPlugin();
  });

  it('goes back to the pasted URL, then to before the paste', async function () {
    // The title used to be a step of its own, so the first undo brought the
    // placeholder back with nothing left to replace it.
    const url = `${base}/slow?ms=800&title=Undone`;
    await openNote('before ‸');
    await paste(url);
    await settled();
    expect(await editorValue()).toBe(`before [Undone](${url})`);
    await undo();
    expect(await editorText()).toBe(`before ${url}‸`);
    await undo();
    expect(await editorValue()).toBe('before ');
  });

  it('redoes the pasted URL, then the title', async function () {
    const url = `${base}/slow?ms=800&title=Again`;
    await openNote('before ‸');
    await paste(url);
    await settled();
    await undo();
    await undo();
    expect(await editorValue()).toBe('before ');
    await redo();
    expect(await editorValue()).toBe(`before ${url}`);
    await redo();
    expect(await editorValue()).toBe(`before [Again](${url})`);
  });

  it('gives back the URL as it was pasted', async function () {
    const url = `${base}/slow?ms=800&title=Angled`;
    await openNote('‸');
    await paste(`<${url}>`);
    await settled();
    expect(await editorValue()).toBe(`[Angled](${url})`);
    await undo();
    expect(await editorValue()).toBe(`<${url}>`);
  });

  it('restores the selection the paste replaced', async function () {
    // Off, so the paste replaces the selection with the fetched title rather
    // than linking the selected text.
    await setSettings({ useSelectionAsTitle: false });
    const url = `${base}/slow?ms=800&title=Replaced`;
    await openNote('see «this» now');
    await paste(url);
    await settled();
    await undo();
    expect(await editorValue()).toBe(`see ${url} now`);
    await undo();
    expect(await editorValue()).toBe('see this now');
    expect(await selection()).toBe('this');
  });

  it('keeps text typed just before the paste', async function () {
    // Typing and a paste moments later would share an undo step if the paste
    // weren't kept apart, and the undo would take the typing too.
    await openNote('‸');
    const url = `${base}/slow?ms=800&title=Kept`;
    await browser.executeObsidian(({ app, obsidian }, url) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
      const cm = (view.editor as any).cm;
      cm.dispatch({
        changes: { from: 0, insert: 'typed ' },
        selection: { anchor: 6 },
        userEvent: 'input.type',
      });
      const data = new DataTransfer();
      data.setData('text/plain', url);
      cm.contentDOM.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    }, url);
    await settled();
    expect(await editorValue()).toBe(`typed [Kept](${url})`);
    await undo();
    await undo();
    expect(await editorValue()).toBe('typed ');
  });

  it('keeps text typed just after the title out of its undo step', async function () {
    const url = `${base}/slow?ms=800&title=Before`;
    await openNote('‸');
    await paste(url);
    await settled();
    await type(' after');
    await undo();
    expect(await editorValue()).toBe(`[Before](${url})`);
  });

  it('undoes several URLs pasted at once in two steps', async function () {
    // The second title arrives first, so the history is rewritten for each
    // title in turn rather than built in paste order.
    const one = `${base}/slow?ms=1400&title=One`;
    const two = `${base}/slow?ms=700&title=Two`;
    await openNote('list: ‸');
    await paste(`${one}\n${two}`);
    await settled();
    expect(await editorValue()).toBe(`list: [One](${one})\n[Two](${two})`);
    await undo();
    expect(await editorValue()).toBe(`list: ${one}\n${two}`);
    await undo();
    expect(await editorValue()).toBe('list: ');
  });

  it('undoes a paste whose title was not found in one step', async function () {
    // A lookup that gives up after the timeout, so the URL goes back in well
    // after the paste rather than within the same moment.
    await browser.executeObsidian(({ app }) => {
      (app as any).plugins.plugins['named-links'].requestTimeoutMs = 800;
    });
    await openNote('a ‸ b');
    await paste(`${base}/slow`);
    await settled();
    expect(await editorValue()).toBe(`a ${base}/slow b`);
    await undo();
    expect(await editorValue()).toBe('a  b');
  });

  it('goes back to the pasted URL when the note was edited meanwhile', async function () {
    // The paste is no longer the latest thing to undo, so the title arrives
    // as steps on top of the edit, and the first still gives the URL back.
    await openNote('start ‸');
    const url = `${base}/slow?ms=1000&title=Late`;
    await paste(url);
    await type(' then more');
    await settled();
    expect(await editorValue()).toBe(`start [Late](${url}) then more`);
    await undo();
    expect(await editorValue()).toBe(`start ${url} then more`);
  });

  describe('Add a title to an existing URL', function () {
    it('undoes back to the original link in one step', async function () {
      const url = `${base}/slow?ms=800&title=Fresh`;
      const original = `a [stale text](${url}) b`;
      await openNote(`a [stale‸ text](${url}) b`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`a [Fresh](${url}) b`);
      await undo();
      expect(await editorValue()).toBe(original);
    });

    it('undoes back to the bare URL in one step', async function () {
      const url = `${base}/slow?ms=800&title=Bare`;
      await openNote(`see ${url}‸ ok`);
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`see [Bare](${url}) ok`);
      await undo();
      expect(await editorValue()).toBe(`see ${url} ok`);
    });

    it('undoes every URL in a selection in one step', async function () {
      const a = `${base}/slow?ms=700&title=A`;
      const b = `${base}/slow?ms=1400&title=B`;
      const original = `${a}\n${b}`;
      await openNote(`«${original}»`, { source: true });
      await runCommand('enhance-url-with-title');
      await settled();
      expect(await editorValue()).toBe(`[A](${a})\n[B](${b})`);
      await undo();
      expect(await editorValue()).toBe(original);
    });
  });
});
