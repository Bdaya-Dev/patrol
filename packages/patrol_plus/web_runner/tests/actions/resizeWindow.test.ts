import assert from "node:assert/strict"
import { test } from "node:test"
import { isSemanticsTreeSettled, resolveResizeSettleTimeoutMs } from "../resizeSettle.ts"
import type { SemanticsNodeRect } from "../resizeSettle.ts"

// ---- resolveResizeSettleTimeoutMs -------------------------------------------

test("resolveResizeSettleTimeoutMs: defaults to 5000ms when unset", () => {
  assert.equal(resolveResizeSettleTimeoutMs({}), 5000)
})

test("resolveResizeSettleTimeoutMs: defaults to 5000ms when empty", () => {
  assert.equal(resolveResizeSettleTimeoutMs({ PATROL_WEB_RESIZE_SETTLE_TIMEOUT: "" }), 5000)
})

test("resolveResizeSettleTimeoutMs: honours an explicit override", () => {
  assert.equal(resolveResizeSettleTimeoutMs({ PATROL_WEB_RESIZE_SETTLE_TIMEOUT: "12000" }), 12000)
})

test("resolveResizeSettleTimeoutMs: falls back to the default on a non-numeric value", () => {
  assert.equal(resolveResizeSettleTimeoutMs({ PATROL_WEB_RESIZE_SETTLE_TIMEOUT: "not-a-number" }), 5000)
})

test("resolveResizeSettleTimeoutMs: falls back to the default on a non-positive value", () => {
  assert.equal(resolveResizeSettleTimeoutMs({ PATROL_WEB_RESIZE_SETTLE_TIMEOUT: "0" }), 5000)
  assert.equal(resolveResizeSettleTimeoutMs({ PATROL_WEB_RESIZE_SETTLE_TIMEOUT: "-500" }), 5000)
})

// ---- isSemanticsTreeSettled --------------------------------------------------

const rect = (left: number, top: number, width = 10, height = 10): SemanticsNodeRect => ({
  left,
  top,
  width,
  height,
})

test("isSemanticsTreeSettled: an empty list is trivially settled (accessibility never activated)", () => {
  assert.equal(isSemanticsTreeSettled([], 800, 600), true)
})

test("isSemanticsTreeSettled: all nodes within the new bounds are settled", () => {
  const rects = [rect(0, 0), rect(100, 100), rect(799, 599, 1, 1)]
  assert.equal(isSemanticsTreeSettled(rects, 800, 600), true)
})

test("isSemanticsTreeSettled: a node whose left edge is past the new width is not settled", () => {
  const rects = [rect(0, 0), rect(1200, 0)]
  assert.equal(isSemanticsTreeSettled(rects, 800, 600), false)
})

test("isSemanticsTreeSettled: a node whose top edge is past the new height is not settled", () => {
  const rects = [rect(0, 900)]
  assert.equal(isSemanticsTreeSettled(rects, 800, 600), false)
})

test("isSemanticsTreeSettled: zero-sized (hidden/pruned) nodes are ignored regardless of position", () => {
  const rects = [rect(5000, 5000, 0, 0)]
  assert.equal(isSemanticsTreeSettled(rects, 800, 600), true)
})

test("isSemanticsTreeSettled: a mix of settled and stale nodes is not settled", () => {
  const rects = [rect(0, 0), rect(2000, 2000)]
  assert.equal(isSemanticsTreeSettled(rects, 800, 600), false)
})
