import React, { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let isMonacoInitialized = false;

function initMonacoWorkers() {
  if (isMonacoInitialized) return;
  const globalEnv = globalThis as typeof globalThis & {
    MonacoEnvironment?: monaco.Environment;
  };

  globalEnv.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  // Define premium NEXUS dark theme
  monaco.editor.defineTheme("nexus-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "a855f7", fontStyle: "bold" },
      { token: "string", foreground: "22d3ee" },
      { token: "number", foreground: "f59e0b" },
      { token: "type", foreground: "38bdf8" },
      { token: "function", foreground: "c084fc" },
    ],
    colors: {
      "editor.background": "#07070b",
      "editor.foreground": "#f3f4f6",
      "editorLineNumber.foreground": "#4b5563",
      "editorLineNumber.activeForeground": "#c084fc",
      "editor.selectionBackground": "#8b5cf633",
      "editor.inactiveSelectionBackground": "#8b5cf61a",
      "editorCursor.foreground": "#a855f7",
      "editorWhitespace.foreground": "#1f2937",
      "editorGutter.background": "#07070b",
    },
  });

  isMonacoInitialized = true;
}

export interface NexusMonacoEditorProps {
  value: string;
  language?: string;
  onChange?: (val: string) => void;
  fontSize?: number;
  readOnly?: boolean;
  theme?: "nexus-dark" | "vs-dark" | "vs";
  className?: string;
  onSelectionChange?: (selectedText: string) => void;
}

export const NexusMonacoEditor: React.FC<NexusMonacoEditorProps> = ({
  value,
  language = "python",
  onChange,
  fontSize = 14,
  readOnly = false,
  theme = "nexus-dark",
  className = "h-full w-full",
  onSelectionChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const isUpdatingFromPropRef = useRef(false);

  // Normalize language for Monaco
  const getMonacoLang = (lang: string): string => {
    const l = lang.toLowerCase();
    if (l.includes("python") || l === "py") return "python";
    if (l.includes("typescript") || l === "ts") return "typescript";
    if (l.includes("javascript") || l === "js") return "javascript";
    if (l.includes("c++") || l.includes("cpp")) return "cpp";
    if (l.includes("c#") || l.includes("csharp")) return "csharp";
    if (l.includes("java")) return "java";
    if (l.includes("go")) return "go";
    if (l.includes("rust")) return "rust";
    if (l.includes("sql")) return "sql";
    return "python";
  };

  useEffect(() => {
    initMonacoWorkers();
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: getMonacoLang(language),
      theme,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      lineNumbers: "on",
      roundedSelection: true,
      automaticLayout: true,
      readOnly,
      tabSize: 4,
      padding: { top: 12, bottom: 12 },
    });

    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      if (!isUpdatingFromPropRef.current && onChange) {
        onChange(editor.getValue());
      }
    });

    const selectionSub = editor.onDidChangeCursorSelection((e) => {
      if (onSelectionChange) {
        const sel = editor.getModel()?.getValueInRange(e.selection) || "";
        onSelectionChange(sel);
      }
    });

    return () => {
      changeSub.dispose();
      selectionSub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Update value without losing cursor position
  useEffect(() => {
    if (!editorRef.current) return;
    const currentVal = editorRef.current.getValue();
    if (value !== currentVal) {
      isUpdatingFromPropRef.current = true;
      editorRef.current.setValue(value);
      isUpdatingFromPropRef.current = false;
    }
  }, [value]);

  // Update language
  useEffect(() => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, getMonacoLang(language));
    }
  }, [language]);

  // Update theme & font size
  useEffect(() => {
    if (!editorRef.current) return;
    monaco.editor.setTheme(theme);
    editorRef.current.updateOptions({ fontSize, readOnly });
  }, [theme, fontSize, readOnly]);

  return <div ref={containerRef} className={className} />;
};
