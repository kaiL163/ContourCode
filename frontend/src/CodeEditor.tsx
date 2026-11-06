import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import "./code-editor.scss";

const externalChange = Annotation.define<boolean>();
const highlighting = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.modifier],
    class: "syntax-keyword",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    class: "syntax-type",
  },
  { tag: [tags.string, tags.character, tags.regexp], class: "syntax-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "syntax-number" },
  {
    tag: [tags.lineComment, tags.blockComment, tags.docComment],
    class: "syntax-comment",
  },
  { tag: [tags.meta, tags.processingInstruction], class: "syntax-meta" },
  { tag: tags.function(tags.variableName), class: "syntax-function" },
]);

type Props = { value: string; onChange: (value: string) => void };

export default function CodeEditor({ value, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const changeHandler = useRef(onChange);
  changeHandler.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          cpp(),
          syntaxHighlighting(highlighting),
          EditorState.changeFilter.of((transaction) =>
            !transaction.isUserEvent("delete.cut"),
          ),
          EditorView.contentAttributes.of({
            "aria-label": "Исходный код решения на C++17",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalChange),
              )
            ) {
              changeHandler.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    editor.current = view;

    const blockClipboard = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockClipboardKeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      const clipboardShortcut = modifier && ["c", "v", "x"].includes(key);
      const alternateShortcut =
        (event.shiftKey && (key === "insert" || key === "delete")) ||
        (event.shiftKey && key === "з");
      if (clipboardShortcut || alternateShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    view.dom.addEventListener("copy", blockClipboard, true);
    view.dom.addEventListener("cut", blockClipboard, true);
    view.dom.addEventListener("paste", blockClipboard, true);
    view.dom.addEventListener("keydown", blockClipboardKeys, true);
    view.dom.addEventListener("contextmenu", blockContextMenu, true);
    return () => {
      view.dom.removeEventListener("copy", blockClipboard, true);
      view.dom.removeEventListener("cut", blockClipboard, true);
      view.dom.removeEventListener("paste", blockClipboard, true);
      view.dom.removeEventListener("keydown", blockClipboardKeys, true);
      view.dom.removeEventListener("contextmenu", blockContextMenu, true);
      view.destroy();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: [
          externalChange.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
    }
  }, [value]);

  return <div className="code-editor" ref={container} />;
}
