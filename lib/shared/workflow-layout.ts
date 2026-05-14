import type { Workflow, WorkflowNode } from './workflow';

export const LOOP_DEFAULT_W = 460;
export const LOOP_DEFAULT_H = 240;
export const NODE_DEFAULT_W = 220;
export const NODE_DEFAULT_H = 72;
export const LOOP_PAD_LEFT = 24;
export const LOOP_PAD_RIGHT = 24;
export const LOOP_PAD_TOP = 56;
export const LOOP_PAD_BOTTOM = 24;

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function loopSizeFromChildren(
  children: readonly WorkflowNode[] | undefined,
): { width: number; height: number } {
  if (!children || children.length === 0) {
    return { width: LOOP_DEFAULT_W, height: LOOP_DEFAULT_H };
  }
  let maxRight = 0;
  let maxBottom = 0;
  for (const child of children) {
    const w = child.size?.width ?? NODE_DEFAULT_W;
    const h = child.size?.height ?? NODE_DEFAULT_H;
    const right = (child.position?.x ?? 0) + w;
    const bottom = (child.position?.y ?? 0) + h;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return {
    width: Math.max(LOOP_DEFAULT_W, maxRight + LOOP_PAD_LEFT + LOOP_PAD_RIGHT),
    height: Math.max(LOOP_DEFAULT_H, maxBottom + LOOP_PAD_TOP + LOOP_PAD_BOTTOM),
  };
}

function bboxOf(
  node: WorkflowNode,
  defaultW = NODE_DEFAULT_W,
  defaultH = NODE_DEFAULT_H,
): Bbox {
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    w: node.size?.width ?? defaultW,
    h: node.size?.height ?? defaultH,
  };
}

function rectsOverlap(a: Bbox, b: Bbox): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export interface CandidateNode {
  id: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface LoopBbox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pushOutsideLoops(
  candidate: CandidateNode,
  topLevelNodes: readonly WorkflowNode[],
): { x: number; y: number } {
  const cw = candidate.size?.width ?? NODE_DEFAULT_W;
  const ch = candidate.size?.height ?? NODE_DEFAULT_H;
  let { x, y } = candidate.position;

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const loop of topLevelNodes) {
      if (loop.type !== 'loop') continue;
      if (loop.id === candidate.id) continue;
      const lx = loop.position.x;
      const ly = loop.position.y;
      const lw = loop.size?.width ?? LOOP_DEFAULT_W;
      const lh = loop.size?.height ?? LOOP_DEFAULT_H;
      const overlaps =
        x < lx + lw && x + cw > lx && y < ly + lh && y + ch > ly;
      if (!overlaps) continue;

      const pushLeft = lx - cw - x;
      const pushRight = lx + lw - x;
      const pushUp = ly - ch - y;
      const pushDown = ly + lh - y;
      const choices = [
        { dx: pushLeft, dy: 0, dist: Math.abs(pushLeft) },
        { dx: pushRight, dy: 0, dist: Math.abs(pushRight) },
        { dx: 0, dy: pushUp, dist: Math.abs(pushUp) },
        { dx: 0, dy: pushDown, dist: Math.abs(pushDown) },
      ];
      choices.sort((a, b) => a.dist - b.dist);
      x += choices[0].dx;
      y += choices[0].dy;
      moved = true;
    }
    if (!moved) break;
  }

  return { x, y };
}

export function pushSiblingsAfterLoopChange(
  newBbox: LoopBbox,
  topLevelNodes: readonly WorkflowNode[],
): Array<{ id: string; position: { x: number; y: number } }> {
  const syntheticLoop: WorkflowNode = {
    id: newBbox.id,
    type: 'loop',
    position: { x: newBbox.x, y: newBbox.y },
    config: { maxIterations: 1, mode: 'while-not-met' },
    size: { width: newBbox.width, height: newBbox.height },
  };
  const updates: Array<{ id: string; position: { x: number; y: number } }> = [];
  for (const node of topLevelNodes) {
    if (node.id === newBbox.id) continue;
    if (node.type === 'loop') continue;
    const next = pushOutsideLoops(
      { id: node.id, position: node.position, size: node.size },
      [syntheticLoop],
    );
    if (next.x !== node.position.x || next.y !== node.position.y) {
      updates.push({ id: node.id, position: next });
    }
  }
  return updates;
}

export function findContainingLoop(
  position: { x: number; y: number },
  topLevelNodes: readonly WorkflowNode[],
): WorkflowNode | null {
  let hit: WorkflowNode | null = null;
  for (const node of topLevelNodes) {
    if (node.type !== 'loop') continue;
    const lx = node.position.x;
    const ly = node.position.y;
    const lw = node.size?.width ?? LOOP_DEFAULT_W;
    const lh = node.size?.height ?? LOOP_DEFAULT_H;
    if (
      position.x >= lx &&
      position.x <= lx + lw &&
      position.y >= ly &&
      position.y <= ly + lh
    ) {
      hit = node;
    }
  }
  return hit;
}

export function normalizeWorkflowGeometry(workflow: Workflow): Workflow {
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return workflow;
  }

  let touched = false;
  const sized = workflow.nodes.map((node) => {
    if (node.type !== 'loop' || node.size) return node;
    touched = true;
    return { ...node, size: loopSizeFromChildren(node.children) } as WorkflowNode;
  });

  const loopBoxes = sized
    .filter((node) => node.type === 'loop')
    .map((node) => ({
      id: node.id,
      ...bboxOf(node, LOOP_DEFAULT_W, LOOP_DEFAULT_H),
    }));

  const next = sized.map((node) => {
    if (node.type === 'loop') return node;
    const box = bboxOf(node);
    let { x, y } = { x: box.x, y: box.y };
    let pushed = false;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const loopBox of loopBoxes) {
        const current: Bbox = { x, y, w: box.w, h: box.h };
        if (!rectsOverlap(current, loopBox)) continue;
        const pushRight = loopBox.x + loopBox.w;
        const pushLeft = loopBox.x - box.w;
        const dRight = pushRight - x;
        const dLeft = x - pushLeft;
        x = dLeft <= dRight ? pushLeft : pushRight;
        moved = true;
        pushed = true;
      }
      if (!moved) break;
    }
    if (!pushed) return node;
    touched = true;
    return { ...node, position: { x, y } };
  });

  return touched ? { ...workflow, nodes: next } : workflow;
}
