/**
 * tickdeck
 * Copyright 2026 yakenator
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type Coordinate from './Coordinate'
import type Nullable from './Nullable'

/**
 * Pointer position handed to chart callbacks. `x` and `y` are relative to the
 * element the handler is attached to; `pageX` and `pageY` are document coordinates.
 */
export interface MouseTouchEvent extends Coordinate {
  pageX: number
  pageY: number
  isTouch?: boolean
  preventDefault?: () => void
}

/**
 * Returns true when the event was consumed. `other` is the pinch scale relative to
 * the start of the pinch for `pinchEvent`, the zoom amount for `mouseWheelVertEvent`
 * (positive zooms in, about 1 per wheel notch) and the scroll distance in pixels for
 * `mouseWheelHortEvent` (positive moves the content to the right).
 */
export type MouseTouchEventCallback = (event: MouseTouchEvent, other?: number) => boolean

export interface EventHandler {
  pinchStartEvent?: MouseTouchEventCallback
  pinchEvent?: MouseTouchEventCallback
  pinchEndEvent?: MouseTouchEventCallback
  mouseWheelHortEvent?: MouseTouchEventCallback
  mouseWheelVertEvent?: MouseTouchEventCallback
  mouseClickEvent?: MouseTouchEventCallback
  mouseRightClickEvent?: MouseTouchEventCallback
  tapEvent?: MouseTouchEventCallback
  mouseDoubleClickEvent?: MouseTouchEventCallback
  doubleTapEvent?: MouseTouchEventCallback
  mouseDownEvent?: MouseTouchEventCallback
  touchStartEvent?: MouseTouchEventCallback
  mouseUpEvent?: MouseTouchEventCallback
  touchEndEvent?: MouseTouchEventCallback
  touchCancelEvent?: MouseTouchEventCallback
  mouseDownOutsideEvent?: MouseTouchEventCallback
  mouseEnterEvent?: MouseTouchEventCallback
  mouseLeaveEvent?: MouseTouchEventCallback
  mouseMoveEvent?: MouseTouchEventCallback
  pressedMouseMoveEvent?: MouseTouchEventCallback
  touchMoveEvent?: MouseTouchEventCallback
  longTapEvent?: MouseTouchEventCallback
}

export type EventName = keyof EventHandler

export interface EventOptions {
  /**
   * Return true to hand a one-finger drag that is mostly vertical to the page instead
   * of the chart. The page only scrolls if the element's CSS `touch-action` allows it.
   */
  treatVertDragAsPageScroll: () => boolean
  /** Same as `treatVertDragAsPageScroll`, for drags that are mostly horizontal. */
  treatHorzDragAsPageScroll: () => boolean
}

/** A touch that lands closer than this (px) to the previous one counts as the same spot. */
export const TOUCH_MIN_RADIUS = 12

/** A mouse press turns into a drag once it travels more than this many pixels. */
const DRAG_THRESHOLD = 3
/** A finger may travel this far and still produce a tap or a long press. */
const TAP_SLOP = 8
const LONG_PRESS_DELAY = 500
/** Maximum time from the end of one click (tap) to the start of the next one. */
const DOUBLE_CLICK_INTERVAL = 400
const DOUBLE_CLICK_SLOP = 6
const DOUBLE_TAP_INTERVAL = 300
const DOUBLE_TAP_SLOP = 24
/** Context menus this soon after touch input come from a long press, not a mouse. */
const TOUCH_CONTEXT_MENU_WINDOW = 800
const WHEEL_LINE_HEIGHT = 32
const WHEEL_NOTCH = 100
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2

const TARGET_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerenter',
  'pointerleave',
  'lostpointercapture',
  'contextmenu',
  'wheel'
] as const

interface Point {
  clientX: number
  clientY: number
  pageX: number
  pageY: number
}

interface Release {
  time: number
  point: Point
}

interface MousePress {
  pointerId: number
  origin: Point
  startTime: number
  dragging: boolean
  clickable: boolean
}

interface Pinch {
  ids: [number, number]
  baseDistance: number
}

interface TouchSession {
  primaryId: number
  origin: Point
  startTime: number
  points: Map<number, Point>
  timer: Nullable<ReturnType<typeof setTimeout>>
  travelled: boolean
  longPressed: boolean
  pinch: Nullable<Pinch>
  pinched: boolean
  abandoned: boolean
}

function toPoint(source: Point): Point {
  return { clientX: source.clientX, clientY: source.clientY, pageX: source.pageX, pageY: source.pageY }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
}

function midpoint(a: Point, b: Point): Point {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
    pageX: (a.pageX + b.pageX) / 2,
    pageY: (a.pageY + b.pageY) / 2
  }
}

function followsQuickly(previous: Nullable<Release>, time: number, point: Point, interval: number, slop: number): boolean {
  return previous !== null && time - previous.time <= interval && distance(previous.point, point) <= slop
}

/**
 * Translates Pointer Events and wheel events on `target` into the chart callbacks of
 * `handler`.
 *
 * - Mouse and pen: hover moves, press, drag, release, click, double click and the
 *   context menu (dispatched as a right click; the native menu is suppressed).
 * - Touch: start, move, end and cancel of a one-finger gesture, tap, double tap,
 *   long press, and pinch from the first two fingers.
 * - Wheel: vertical deltas zoom, horizontal deltas (or Shift + wheel) scroll.
 */
export default class EventHandlerImp {
  private readonly _target: HTMLElement
  private readonly _handler: EventHandler
  private readonly _options: EventOptions

  private _mouse: Nullable<MousePress> = null
  private _touch: Nullable<TouchSession> = null
  private _lastClick: Nullable<Release> = null
  private _lastTap: Nullable<Release> = null
  private _lastTouchTime = Number.NEGATIVE_INFINITY

  private readonly _onDocumentPointerDown = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this._target)) {
      this._emit('mouseDownOutsideEvent', event, event.pointerType === 'touch', event)
    }
  }

  constructor(target: HTMLElement, handler: EventHandler, options: EventOptions) {
    this._target = target
    this._handler = handler
    this._options = options
    for (const type of TARGET_EVENTS) {
      target.addEventListener(type, this, { passive: false })
    }
    if (handler.mouseDownOutsideEvent !== undefined) {
      target.ownerDocument.addEventListener('pointerdown', this._onDocumentPointerDown, true)
    }
  }

  handleEvent(event: Event): void {
    switch (event.type) {
      case 'wheel': {
        this._onWheel(event as WheelEvent)
        break
      }
      case 'contextmenu': {
        this._onContextMenu(event as MouseEvent)
        break
      }
      default: {
        const pointerEvent = event as PointerEvent
        if (pointerEvent.pointerType === 'touch') {
          this._onTouchPointer(pointerEvent)
        } else {
          this._onMousePointer(pointerEvent)
        }
      }
    }
  }

  destroy(): void {
    for (const type of TARGET_EVENTS) {
      this._target.removeEventListener(type, this)
    }
    this._target.ownerDocument.removeEventListener('pointerdown', this._onDocumentPointerDown, true)
    if (this._mouse !== null) {
      this._release(this._mouse.pointerId)
      this._mouse = null
    }
    if (this._touch !== null) {
      this._stopLongPress(this._touch)
      for (const id of this._touch.points.keys()) {
        this._release(id)
      }
      this._touch = null
    }
  }

  private _onMousePointer(event: PointerEvent): void {
    const press = this._mouse
    switch (event.type) {
      case 'pointerdown': {
        if (event.button !== 0 || press !== null) {
          return
        }
        this._capture(event.pointerId)
        this._mouse = { pointerId: event.pointerId, origin: toPoint(event), startTime: performance.now(), dragging: false, clickable: true }
        this._emit('mouseDownEvent', event, false, event)
        break
      }
      case 'pointermove': {
        if (press === null) {
          this._emit('mouseMoveEvent', event, false, event)
          return
        }
        if (press.pointerId !== event.pointerId) {
          return
        }
        if (!press.dragging && distance(press.origin, event) > DRAG_THRESHOLD) {
          press.dragging = true
          press.clickable = false
        }
        if (press.dragging) {
          this._emit('pressedMouseMoveEvent', event, false, event)
        }
        break
      }
      case 'pointerup': {
        if (press?.pointerId === event.pointerId) {
          this._finishMousePress(press, event, false)
        }
        break
      }
      case 'pointercancel':
      case 'lostpointercapture': {
        if (press?.pointerId === event.pointerId) {
          this._finishMousePress(press, event, true)
        }
        break
      }
      case 'pointerenter': {
        this._emit('mouseEnterEvent', event, false, event)
        break
      }
      case 'pointerleave': {
        // Without pointer capture the release would happen outside and never reach us.
        if (press !== null && !this._hasCapture(press.pointerId)) {
          this._finishMousePress(press, event, true)
        }
        this._emit('mouseLeaveEvent', event, false, event)
        break
      }
    }
  }

  private _finishMousePress(press: MousePress, event: PointerEvent, cancelled: boolean): void {
    this._mouse = null
    this._emit('mouseUpEvent', event, false, event)
    if (cancelled || !press.clickable) {
      return
    }
    this._emit('mouseClickEvent', event, false, event)
    const point = toPoint(event)
    if (followsQuickly(this._lastClick, press.startTime, press.origin, DOUBLE_CLICK_INTERVAL, DOUBLE_CLICK_SLOP)) {
      this._lastClick = null
      this._emit('mouseDoubleClickEvent', point, false, event)
    } else {
      this._lastClick = { time: performance.now(), point }
    }
  }

  private _onTouchPointer(event: PointerEvent): void {
    this._lastTouchTime = performance.now()
    switch (event.type) {
      case 'pointerdown': {
        this._touchDown(event)
        break
      }
      case 'pointermove': {
        this._touchMove(event)
        break
      }
      case 'pointerup': {
        this._touchUp(event, false)
        break
      }
      case 'pointercancel':
      case 'lostpointercapture': {
        this._touchUp(event, true)
        break
      }
    }
  }

  private _touchDown(event: PointerEvent): void {
    const point = toPoint(event)
    const session = this._touch
    if (session === null) {
      const started: TouchSession = {
        primaryId: event.pointerId,
        origin: point,
        startTime: performance.now(),
        points: new Map([[event.pointerId, point]]),
        timer: null,
        travelled: false,
        longPressed: false,
        pinch: null,
        pinched: false,
        abandoned: false
      }
      started.timer = setTimeout(() => {
        this._onLongPress(started)
      }, LONG_PRESS_DELAY)
      this._touch = started
      this._capture(event.pointerId)
      this._emit('touchStartEvent', point, true, event)
      return
    }
    session.points.set(event.pointerId, point)
    this._capture(event.pointerId)
    if (session.abandoned || session.pinch !== null || session.points.size !== 2) {
      return
    }
    this._stopLongPress(session)
    const [first, second] = [...session.points.keys()]
    const a = session.points.get(first)!
    const b = session.points.get(second)!
    session.pinch = { ids: [first, second], baseDistance: distance(a, b) }
    session.pinched = true
    this._emit('pinchStartEvent', midpoint(a, b), true, event)
  }

  private _touchMove(event: PointerEvent): void {
    const session = this._touch
    if (session === null || !session.points.has(event.pointerId)) {
      return
    }
    const point = toPoint(event)
    session.points.set(event.pointerId, point)
    if (session.abandoned) {
      return
    }
    const pinch = session.pinch
    if (pinch !== null) {
      if (pinch.ids.includes(event.pointerId)) {
        const a = session.points.get(pinch.ids[0])!
        const b = session.points.get(pinch.ids[1])!
        const span = distance(a, b)
        if (pinch.baseDistance > 0) {
          this._emit('pinchEvent', midpoint(a, b), true, event, span / pinch.baseDistance)
        } else {
          pinch.baseDistance = span
        }
      }
      return
    }
    if (session.pinched || event.pointerId !== session.primaryId) {
      return
    }
    if (!session.travelled && !session.longPressed) {
      const dx = point.clientX - session.origin.clientX
      const dy = point.clientY - session.origin.clientY
      if (Math.hypot(dx, dy) <= TAP_SLOP) {
        return
      }
      session.travelled = true
      this._stopLongPress(session)
      const handToPage = Math.abs(dx) > Math.abs(dy) ? this._options.treatHorzDragAsPageScroll() : this._options.treatVertDragAsPageScroll()
      if (handToPage) {
        session.abandoned = true
        this._emit('touchCancelEvent', point, true, event)
        return
      }
    }
    session.travelled = true
    this._emit('touchMoveEvent', point, true, event)
  }

  private _touchUp(event: PointerEvent, cancelled: boolean): void {
    const session = this._touch
    if (session === null || !session.points.has(event.pointerId)) {
      return
    }
    const point = toPoint(event)
    session.points.delete(event.pointerId)
    const pinch = session.pinch
    if (pinch !== null && pinch.ids.includes(event.pointerId)) {
      const partnerId = pinch.ids[0] === event.pointerId ? pinch.ids[1] : pinch.ids[0]
      session.pinch = null
      this._emit('pinchEndEvent', midpoint(point, session.points.get(partnerId) ?? point), true, event)
    }
    if (cancelled && !session.abandoned) {
      session.abandoned = true
      this._stopLongPress(session)
      this._emit('touchCancelEvent', point, true, event)
    }
    if (session.points.size > 0) {
      return
    }
    this._stopLongPress(session)
    if (this._touch === session) {
      this._touch = null
    }
    if (session.abandoned) {
      return
    }
    this._emit('touchEndEvent', point, true, event)
    if (session.travelled || session.longPressed || session.pinched) {
      return
    }
    this._emit('tapEvent', point, true, event)
    if (followsQuickly(this._lastTap, session.startTime, session.origin, DOUBLE_TAP_INTERVAL, DOUBLE_TAP_SLOP)) {
      this._lastTap = null
      this._emit('doubleTapEvent', point, true, event)
    } else {
      this._lastTap = { time: performance.now(), point }
    }
  }

  private _onLongPress(session: TouchSession): void {
    session.timer = null
    if (this._touch !== session || session.travelled || session.pinched || session.abandoned || session.points.size !== 1) {
      return
    }
    const point = session.points.get(session.primaryId)
    if (point !== undefined) {
      session.longPressed = true
      this._emit('longTapEvent', point, true, null)
    }
  }

  private _stopLongPress(session: TouchSession): void {
    if (session.timer !== null) {
      clearTimeout(session.timer)
      session.timer = null
    }
  }

  private _onContextMenu(event: MouseEvent): void {
    event.preventDefault()
    const fromTouch = (event as Partial<PointerEvent>).pointerType === 'touch' || this._touch !== null || performance.now() - this._lastTouchTime < TOUCH_CONTEXT_MENU_WINDOW
    if (fromTouch) {
      return
    }
    // Ctrl + click on macOS opens the menu in the middle of a primary press.
    if (this._mouse !== null) {
      this._mouse.clickable = false
    }
    this._emit('mouseRightClickEvent', event, false, event)
  }

  private _onWheel(event: WheelEvent): void {
    let { deltaX, deltaY } = event
    if (event.deltaMode === DOM_DELTA_LINE) {
      deltaX *= WHEEL_LINE_HEIGHT
      deltaY *= WHEEL_LINE_HEIGHT
    } else if (event.deltaMode === DOM_DELTA_PAGE) {
      deltaX *= this._target.clientWidth
      deltaY *= this._target.clientHeight
    }
    if (event.shiftKey && deltaX === 0) {
      deltaX = deltaY
      deltaY = 0
    }
    if (deltaX === 0 && deltaY === 0) {
      return
    }
    const consumed = Math.abs(deltaX) > Math.abs(deltaY)
      ? this._emit('mouseWheelHortEvent', event, false, event, -deltaX)
      : this._emit('mouseWheelVertEvent', event, false, event, -deltaY / WHEEL_NOTCH)
    if (consumed && event.cancelable) {
      event.preventDefault()
    }
  }

  private _emit(name: EventName, point: Point, isTouch: boolean, source: Nullable<Event>, other?: number): boolean {
    const callback = this._handler[name]
    if (callback === undefined) {
      return false
    }
    return callback.call(this._handler, this._toChartEvent(point, isTouch, source), other)
  }

  private _toChartEvent(point: Point, isTouch: boolean, source: Nullable<Event>): MouseTouchEvent {
    const target = this._target
    const rect = target.getBoundingClientRect()
    // getBoundingClientRect includes CSS transforms; x and y are in untransformed pixels.
    const scaleX = target.offsetWidth > 0 && rect.width > 0 ? rect.width / target.offsetWidth : 1
    const scaleY = target.offsetHeight > 0 && rect.height > 0 ? rect.height / target.offsetHeight : 1
    return {
      x: (point.clientX - rect.left) / scaleX - target.clientLeft,
      y: (point.clientY - rect.top) / scaleY - target.clientTop,
      pageX: point.pageX,
      pageY: point.pageY,
      isTouch,
      preventDefault: () => {
        if (source?.cancelable === true) {
          source.preventDefault()
        }
      }
    }
  }

  private _capture(pointerId: number): void {
    try {
      this._target.setPointerCapture(pointerId)
    } catch {
      // The pointer is no longer active (or the environment lacks pointer capture).
    }
  }

  private _release(pointerId: number): void {
    try {
      if (this._target.hasPointerCapture(pointerId)) {
        this._target.releasePointerCapture(pointerId)
      }
    } catch {
      // Same as _capture.
    }
  }

  private _hasCapture(pointerId: number): boolean {
    try {
      return this._target.hasPointerCapture(pointerId)
    } catch {
      return false
    }
  }
}
