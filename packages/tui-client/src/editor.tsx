/**
 * Text input component for Ink with message history.
 *
 * - Enter: submit
 * - Shift+Enter: newline (terminal must support CSI u / kitty protocol)
 * - Up/Down on first/last line: navigate message history
 * - Paste handles multi-line naturally
 */

import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";

export interface EditorProps {
  /** Called when the user submits (Enter) */
  onSubmit: (text: string) => void;
  /** Placeholder when empty */
  placeholder?: string;
  /** Whether the editor accepts input */
  active?: boolean;
  /** Prompt prefix */
  prefix?: string;
  /** Prefix color */
  prefixColor?: string;
  /** Message history (newest last) */
  history?: string[];
}

interface CursorPos {
  line: number;
  col: number;
}

export function Editor({
  onSubmit,
  placeholder = "Type a message...",
  active = true,
  prefix = "❯",
  prefixColor = "green",
  history = [],
}: EditorProps) {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursor, setCursor] = useState<CursorPos>({ line: 0, col: 0 });
  const [historyOffset, setHistoryOffset] = useState(-1);
  const draftRef = useRef("");

  const isEmpty = lines.length === 1 && lines[0] === "";

  const setFromText = useCallback((text: string) => {
    const newLines = text.split("\n");
    setLines(newLines);
    const lastLine = newLines[newLines.length - 1] ?? "";
    setCursor({ line: newLines.length - 1, col: lastLine.length });
  }, []);

  const submit = useCallback(() => {
    const text = lines.join("\n").trim();
    if (!text) return;
    onSubmit(text);
    setLines([""]);
    setCursor({ line: 0, col: 0 });
    setHistoryOffset(-1);
    draftRef.current = "";
  }, [lines, onSubmit]);

  useInput(
    (input, key) => {
      if (!active) return;

      // Enter: submit. Shift+Enter: newline.
      if (key.return) {
        if (key.shift) {
          // Insert newline
          setLines((prev) => {
            const newLines = [...prev];
            const currentLine = newLines[cursor.line] ?? "";
            newLines[cursor.line] = currentLine.slice(0, cursor.col);
            newLines.splice(cursor.line + 1, 0, currentLine.slice(cursor.col));
            return newLines;
          });
          setCursor((prev) => ({ line: prev.line + 1, col: 0 }));
          setHistoryOffset(-1);
        } else {
          submit();
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cursor.col > 0) {
          setLines((prev) => {
            const newLines = [...prev];
            const line = newLines[cursor.line] ?? "";
            newLines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
            return newLines;
          });
          setCursor((prev) => ({ ...prev, col: prev.col - 1 }));
        } else if (cursor.line > 0) {
          const prevLineLen = lines[cursor.line - 1]?.length ?? 0;
          setLines((prev) => {
            const newLines = [...prev];
            newLines[cursor.line - 1] = (newLines[cursor.line - 1] ?? "") + (newLines[cursor.line] ?? "");
            newLines.splice(cursor.line, 1);
            return newLines;
          });
          setCursor({ line: cursor.line - 1, col: prevLineLen });
        }
        setHistoryOffset(-1);
        return;
      }

      // Left/Right
      if (key.leftArrow) {
        if (cursor.col > 0) {
          setCursor((prev) => ({ ...prev, col: prev.col - 1 }));
        } else if (cursor.line > 0) {
          const prevLen = lines[cursor.line - 1]?.length ?? 0;
          setCursor({ line: cursor.line - 1, col: prevLen });
        }
        return;
      }
      if (key.rightArrow) {
        const lineLen = lines[cursor.line]?.length ?? 0;
        if (cursor.col < lineLen) {
          setCursor((prev) => ({ ...prev, col: prev.col + 1 }));
        } else if (cursor.line < lines.length - 1) {
          setCursor({ line: cursor.line + 1, col: 0 });
        }
        return;
      }

      // Up: history on first line, else move up
      if (key.upArrow) {
        if (cursor.line > 0) {
          const prevLen = lines[cursor.line - 1]?.length ?? 0;
          setCursor({ line: cursor.line - 1, col: Math.min(cursor.col, prevLen) });
        } else if (history.length > 0) {
          const newOffset = historyOffset === -1 ? 0 : Math.min(historyOffset + 1, history.length - 1);
          if (newOffset !== historyOffset) {
            if (historyOffset === -1) draftRef.current = lines.join("\n");
            setHistoryOffset(newOffset);
            setFromText(history[history.length - 1 - newOffset] ?? "");
          }
        }
        return;
      }

      // Down: history forward on last line, else move down
      if (key.downArrow) {
        if (cursor.line < lines.length - 1) {
          const nextLen = lines[cursor.line + 1]?.length ?? 0;
          setCursor({ line: cursor.line + 1, col: Math.min(cursor.col, nextLen) });
        } else if (historyOffset >= 0) {
          const newOffset = historyOffset - 1;
          if (newOffset < 0) {
            setHistoryOffset(-1);
            setFromText(draftRef.current);
          } else {
            setHistoryOffset(newOffset);
            setFromText(history[history.length - 1 - newOffset] ?? "");
          }
        }
        return;
      }

      // Escape, Tab: ignore
      if (key.escape || key.tab) return;

      // Regular character input (including pasted text which may contain newlines)
      if (input && !key.ctrl && !key.meta) {
        // Pasted text may contain newlines
        if (input.includes("\n")) {
          const parts = input.split("\n");
          setLines((prev) => {
            const newLines = [...prev];
            const currentLine = newLines[cursor.line] ?? "";
            const before = currentLine.slice(0, cursor.col);
            const after = currentLine.slice(cursor.col);
            // First part joins current line
            newLines[cursor.line] = before + parts[0];
            // Middle parts are new lines
            for (let i = 1; i < parts.length - 1; i++) {
              newLines.splice(cursor.line + i, 0, parts[i]!);
            }
            // Last part gets the "after" text
            const lastPart = parts[parts.length - 1]!;
            newLines.splice(cursor.line + parts.length - 1, 0, lastPart + after);
            // Remove the original split if we added new lines
            if (parts.length > 1) {
              newLines.splice(cursor.line + parts.length, 1);
            }
            return newLines;
          });
          const lastPart = parts[parts.length - 1]!;
          setCursor({ line: cursor.line + parts.length - 1, col: lastPart.length });
        } else {
          setLines((prev) => {
            const newLines = [...prev];
            const line = newLines[cursor.line] ?? "";
            newLines[cursor.line] = line.slice(0, cursor.col) + input + line.slice(cursor.col);
            return newLines;
          });
          setCursor((prev) => ({ ...prev, col: prev.col + input.length }));
        }
        setHistoryOffset(-1);
      }
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column">
      {isEmpty && historyOffset === -1 ? (
        <Box>
          <Text color={prefixColor}>{prefix} </Text>
          <Text dimColor>{placeholder}</Text>
        </Box>
      ) : (
        lines.map((line, i) => (
          <Box key={i}>
            <Text color={prefixColor}>
              {i === 0 ? `${prefix} ` : "  "}
            </Text>
            {active && i === cursor.line ? (
              <Text>
                {line.slice(0, cursor.col)}
                <Text inverse>{line[cursor.col] ?? " "}</Text>
                {line.slice(cursor.col + 1)}
              </Text>
            ) : (
              <Text>{line}</Text>
            )}
          </Box>
        ))
      )}
      {lines.length > 1 && (
        <Text dimColor>  {lines.length} lines</Text>
      )}
    </Box>
  );
}
