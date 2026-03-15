import { describe, expect, it } from "bun:test"
import {
  canSplitPane,
  canSplitPaneAnyDirection,
  findMinimalEvictions,
  getBestSplitDirection,
  getColumnCount,
  getColumnWidth,
  isSplittableAtCount,
} from "./pane-split-availability"
import { DIVIDER_SIZE, MIN_SPLIT_HEIGHT } from "./tmux-grid-constants"
import type { TmuxPaneInfo } from "./types"

function pane(width: number, height: number): TmuxPaneInfo {
  return {
    paneId: "%1",
    width,
    height,
    left: 0,
    top: 0,
    title: "pane",
    isActive: false,
  }
}

describe("pane split availability", () => {
  it("computes columns and widths from pane counts", () => {
    expect(getColumnCount(0)).toBe(1)
    expect(getColumnCount(1)).toBe(1)
    expect(getColumnCount(4)).toBe(2)
    expect(getColumnWidth(200, 4)).toBe(Math.floor((200 - DIVIDER_SIZE) / 2))
  })

  it("determines whether the agent area is splittable and how many evictions are needed", () => {
    expect(isSplittableAtCount(220, 2, 40)).toBe(true)
    expect(isSplittableAtCount(120, 6, 40)).toBe(false)
    expect(findMinimalEvictions(120, 6, 40)).toBe(3)
    expect(findMinimalEvictions(90, 1, 40)).toBe(1)
  })

  it("selects valid split directions from pane dimensions", () => {
    expect(canSplitPane(pane(81, 20), "-h", 40)).toBe(true)
    expect(canSplitPane(pane(80, 20), "-h", 40)).toBe(false)
    expect(canSplitPane(pane(50, MIN_SPLIT_HEIGHT), "-v")).toBe(true)
    expect(canSplitPaneAnyDirection(pane(81, 10), 40)).toBe(true)
    expect(canSplitPaneAnyDirection(pane(70, 10), 40)).toBe(false)
  })

  it("picks the best split direction based on available space", () => {
    expect(getBestSplitDirection(pane(81, 10), 40)).toBe("-h")
    expect(getBestSplitDirection(pane(60, MIN_SPLIT_HEIGHT), 40)).toBe("-v")
    expect(getBestSplitDirection(pane(100, 120), 40)).toBe("-v")
    expect(getBestSplitDirection(pane(120, 100), 40)).toBe("-h")
    expect(getBestSplitDirection(pane(60, 10), 40)).toBe(null)
  })
})
