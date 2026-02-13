/**
 * Multi-line text editor component for Ink.
 *
 * - Enter: new line
 * - Ctrl+D: submit
 * - Up/Down on empty first line: navigate message history
 * - Arrow keys: navigate within text
 * - Backspace/Delete: delete characters
 * - Home/End: jump to line start/end
 * - Tab: insert 2 spaces
 */

import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";

export interface EditorProps {
  /** Called when the user submits (Ctrl+D) */
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
  placeholder = "Type a message... (Ctrl+D to send)",
  active = true,
  prefix = "❯",
  prefixColor = "green",
  history = [],
}: EditorProps) {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursor, setCursor] = useState<CursorPos>({ line: 0, col: 0 });
  // History navigation: -1 = not browsing, 0..N = index from end
  const [historyOffset, setHistoryOffset] = useState(-1);
  // Save current draft when entering history
  const draftRef = useRef<string>("");

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

      // Ctrl+D: submit
      if (input === "\x04") {
        submit();
        return;
      }

      // Enter = newline
      if (key.return) {
        setLines((prev) => {
          const newLines = [...prev];
          const currentLine = newLines[cursor.line] ?? "";
          const before = currentLine.slice(0, cursor.col);
          const after = currentLine.slice(cursor.col);
          newLines[cursor.line] = before;
          newLines.splice(cursor.line + 1, 0, after);
          return newLines;
        });
        setCursor((prev) => ({ line: prev.line + 1, col: 0 }));
        setHistoryOffset(-1);
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
            const currentLine = newLines[cursor.line] ?? "";
            newLines[cursor.line - 1] = (newLines[cursor.line - 1] ?? "") + currentLine;
            newLines.splice(cursor.line, 1);
            return newLines;
          });
          setCursor({ line: cursor.line - 1, col: prevLineLen });
        }
        setHistoryOffset(-1);
        return;
      }

      // Up arrow — history navigation when on first line, else move up
      if (key.upArrow) {
        if (cursor.line === 0 && history.length > 0) {
          // Navigate history
          const newOffset = historyOffset === -1 ? 0 : Math.min(historyOffset + 1, history.length - 1);
          if (newOffset !== historyOffset) {
            if (historyOffset === -1) {
              // Save current draft
              draftRef.current = lines.join("\n");
            }
            setHistoryOffset(newOffset);
            const histEntry = history[history.length - 1 - newOffset] ?? "";
            setFromText(histEntry);
          }
        } else if (cursor.line > 0) {
          const prevLen = lines[cursor.line - 1]?.length ?? 0;
          setCursor({ line: cursor.line - 1, col: Math.min(cursor.col, prevLen) });
        }
        return;
      }

      // Down arrow — history navigation or move down
      if (key.downArrow) {
        if (historyOffset >= 0 && cursor.line === lines.length - 1) {
          // Navigate history forward
          const newOffset = historyOffset - 1;
          if (newOffset < 0) {
            // Back to draft
            setHistoryOffset(-1);
            setFromText(draftRef.current);
          } else {
            setHistoryOffset(newOffset);
            const histEntry = history[history.length - 1 - newOffset] ?? "";
            setFromText(histEntry);
          }
        } else if (cursor.line < lines.length - 1) {
          const nextLen = lines[cursor.line + 1]?.length ?? 0;
          setCursor({ line: cursor.line + 1, col: Math.min(cursor.col, nextLen) });
        }
        return;
      }

      // Left/Right arrows
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

      // Tab: insert 2 spaces
      if (key.tab) {
        setLines((prev) => {
          const newLines = [...prev];
          const line = newLines[cursor.line] ?? "";
          newLines[cursor.line] = line.slice(0, cursor.col) + "  " + line.slice(cursor.col);
          return newLines;
        });
        setCursor((prev) => ({ ...prev, col: prev.col + 2 }));
        setHistoryOffset(-1);
        return;
      }

      // Escape: ignore
      if (key.escape) return;

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setLines((prev) => {
          const newLines = [...prev];
          const line = newLines[cursor.line] ?? "";
          newLines[cursor.line] = line.slice(0, cursor.col) + input + line.slice(cursor.col);
          return newLines;
        });
        setCursor((prev) => ({ ...prev, col: prev.col + input.length }));
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
        <Text dimColor>  Ctrl+D to send · {lines.length} lines</Text>
      )}
    </Box>
  );
}
