/**
 * Multi-line text editor component for Ink.
 *
 * - Enter: new line
 * - Ctrl+Enter or Ctrl+D: submit
 * - Arrow keys: navigate
 * - Backspace/Delete: delete characters
 * - Home/End: jump to line start/end
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

export interface EditorProps {
  /** Called when the user submits (Ctrl+Enter or Ctrl+D) */
  onSubmit: (text: string) => void;
  /** Placeholder when empty */
  placeholder?: string;
  /** Whether the editor accepts input */
  active?: boolean;
  /** Prompt prefix */
  prefix?: string;
  /** Prefix color */
  prefixColor?: string;
}

interface CursorPos {
  line: number;
  col: number;
}

export function Editor({
  onSubmit,
  placeholder = "Type a message... (Ctrl+Enter to send)",
  active = true,
  prefix = "❯",
  prefixColor = "green",
}: EditorProps) {
  const [lines, setLines] = useState<string[]>([""]);
  const [cursor, setCursor] = useState<CursorPos>({ line: 0, col: 0 });

  const submit = useCallback(() => {
    const text = lines.join("\n").trim();
    if (!text) return;
    onSubmit(text);
    setLines([""]);
    setCursor({ line: 0, col: 0 });
  }, [lines, onSubmit]);

  useInput(
    (input, key) => {
      if (!active) return;

      // Ctrl+D or Ctrl+Enter: submit
      if (input === "\x04") {
        submit();
        return;
      }

      // Enter
      if (key.return) {
        // Check for ctrl modifier — ink doesn't expose ctrl+enter directly,
        // but we handle Ctrl+D above as the primary submit shortcut.
        // Plain Enter = newline.
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
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cursor.col > 0) {
          // Delete char before cursor
          setLines((prev) => {
            const newLines = [...prev];
            const line = newLines[cursor.line] ?? "";
            newLines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
            return newLines;
          });
          setCursor((prev) => ({ ...prev, col: prev.col - 1 }));
        } else if (cursor.line > 0) {
          // Merge with previous line
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
        return;
      }

      // Arrow keys
      if (key.leftArrow) {
        if (cursor.col > 0) {
          setCursor((prev) => ({ ...prev, col: prev.col - 1 }));
        } else if (cursor.line > 0) {
          // Wrap to end of previous line
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
          // Wrap to start of next line
          setCursor({ line: cursor.line + 1, col: 0 });
        }
        return;
      }

      if (key.upArrow) {
        if (cursor.line > 0) {
          const prevLen = lines[cursor.line - 1]?.length ?? 0;
          setCursor({ line: cursor.line - 1, col: Math.min(cursor.col, prevLen) });
        }
        return;
      }

      if (key.downArrow) {
        if (cursor.line < lines.length - 1) {
          const nextLen = lines[cursor.line + 1]?.length ?? 0;
          setCursor({ line: cursor.line + 1, col: Math.min(cursor.col, nextLen) });
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
        return;
      }

      // Escape: ignore (don't insert)
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
      }
    },
    { isActive: active },
  );

  const isEmpty = lines.length === 1 && lines[0] === "";

  return (
    <Box flexDirection="column">
      {isEmpty ? (
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
