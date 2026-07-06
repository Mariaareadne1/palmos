import type Konva from "konva";

/**
 * The mounted Konva stage, registered by EditorCanvas so top-bar actions
 * (export PNG) can reach it without prop-drilling through the shell.
 */
export const stageRegistry: { current: Konva.Stage | null } = {
  current: null,
};
